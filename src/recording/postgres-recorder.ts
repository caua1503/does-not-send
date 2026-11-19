import type { DomainEvent } from "./events.js";
import { Queue } from "./queue.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { type Store, type Logger, isTransientError } from "./store.js";

export type { Logger };
export interface SessionRecorder {
  record(event: DomainEvent): void;
  stats(): { queued: number; dropped: number; failed: number };
  close(timeoutMs: number): Promise<void>;
}

export interface PostgresRecorderConfig {
  maxQueueSize?: number;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  failureThreshold?: number;
  circuitOpenDurationMs?: number;
}

export class PostgresRecorder implements SessionRecorder {
  private readonly queue: Queue<DomainEvent>;
  private readonly breaker: CircuitBreaker;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly failureThreshold: number;
  private readonly circuitOpenDurationMs: number;

  private dropped = 0;
  private failed = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;
  private stopped = false;
  private circuitWasOpen = false;

  constructor(
    private readonly store: Store,
    private readonly isReady: () => boolean,
    private readonly logger: Logger,
    config: PostgresRecorderConfig = {},
  ) {
    const maxQueueSize = config.maxQueueSize ?? 5000;
    this.maxBatchSize = config.maxBatchSize ?? 100;
    this.flushIntervalMs = config.flushIntervalMs ?? 500;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.circuitOpenDurationMs = config.circuitOpenDurationMs ?? 30_000;

    this.queue = new Queue<DomainEvent>(maxQueueSize);
    this.breaker = new CircuitBreaker({
      failureThreshold: this.failureThreshold,
      openDurationMs: this.circuitOpenDurationMs,
    });

    this.scheduleFlush();
  }

  record(event: DomainEvent): void {
    if (this.stopping) return;

    const wasDiscarded = this.queue.push(event);
    if (wasDiscarded) this.dropped++;

    if (this.queue.size >= this.maxBatchSize) this.requestFlush();
  }

  stats(): { queued: number; dropped: number; failed: number } {
    return {
      queued: this.queue.size,
      dropped: this.dropped,
      failed: this.failed,
    };
  }

  async close(timeoutMs: number): Promise<void> {
    this.stopping = true;
    this.stopWorker();

    if (!this.isReady()) {
      // Database not ready: discard queue immediately
      this.stopped = true;
      const remaining = this.queue.size;
      if (remaining > 0) {
        this.dropped += remaining;
        this.logDiscardedByType(this.queue.drain(remaining));
      }
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); });
    try {
      await Promise.race([this.drainQueue(), deadline]);
    } finally {
      this.stopped = true;
      clearTimeout(timeout);
    }

    // Discard any remaining items
    const remaining = this.queue.size;
    if (remaining > 0) {
      this.dropped += remaining;
      const events = this.queue.drain(remaining);
      this.logger.warn(
        `close: timeout de ${timeoutMs}ms, descartados ${events.length} eventos: ${this.aggregateByType(events)}`,
      );
    }
  }

  private scheduleFlush(): void {
    if (this.stopping || this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.inFlight && !this.stopping) {
        void this.flush();
      }
      // Reschedule for next cycle
      if (!this.stopping) {
        this.scheduleFlush();
      }
    }, this.flushIntervalMs);

    this.timer.unref();
  }

  private requestFlush(): void {
    if (this.stopping || this.inFlight || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      void this.flush();
    });
    this.scheduled.unref();
  }

  private stopWorker(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.scheduled) clearImmediate(this.scheduled);
    this.timer = null;
    this.scheduled = null;
  }

  private flush(): Promise<void> | undefined {
    if (this.inFlight || this.stopped || this.queue.size === 0 || !this.isReady()) return;

    if (!this.breaker.canAttempt()) {
      if (this.breaker.getState() === "open") this.circuitWasOpen = true;
      return;
    }

    this.inFlight = this.processBatch()
      .catch(() => {
        // Errors handled in processBatch.
      })
      .finally(() => {
        this.inFlight = null;
        if (this.queue.size > 0) this.requestFlush();
      });
    return this.inFlight;
  }

  private async processBatch(): Promise<void> {
    const batch = this.queue.drain(this.maxBatchSize);
    if (batch.length === 0) return;

    try {
      await this.store.apply(batch);
      this.breaker.recordSuccess();

      // Log if circuit was open and just recovered
      if (this.circuitWasOpen) {
        this.logger.info("circuit closed");
        this.circuitWasOpen = false;
      }
    } catch (err) {
      await this.handleBatchError(batch, err);
    }
  }

  private async handleBatchError(batch: DomainEvent[], err: unknown): Promise<void> {
    if (isTransientError(err)) {
      // Transient error: return batch to queue, count for breaker
      const discarded = this.stopped ? batch : this.queue.unshift(batch);
      this.dropped += discarded.length;
      if (discarded.length > 0) {
        this.logDiscardedByType(discarded);
      }

      const justOpened = this.breaker.recordFailure();
      if (justOpened) {
        this.logger.error(
          `circuit open após ${this.failureThreshold} falhas, retry em ${this.circuitOpenDurationMs / 1000}s`,
        );
        this.circuitWasOpen = true;
      }
      return;
    }

    // Non-transient error: reprocess item-by-item
    await this.reprocessItemByItem(batch);
  }

  private async reprocessItemByItem(batch: DomainEvent[]): Promise<void> {
    const failedByType: Map<string, number> = new Map();

    for (let i = 0; i < batch.length; i++) {
      const event = batch[i];
      if (!event) continue;

      try {
        await this.store.apply([event]);
      } catch (err) {
        if (isTransientError(err)) {
          // Transient error during item-by-item: stop and return rest to queue
          const rest = batch.slice(i);
          const discarded = this.stopped ? rest : this.queue.unshift(rest);
          this.dropped += discarded.length;
          if (discarded.length > 0) {
            this.logDiscardedByType(discarded);
          }

          const justOpened = this.breaker.recordFailure();
          if (justOpened) {
            this.logger.error(
              `circuit open após ${this.failureThreshold} falhas, retry em ${this.circuitOpenDurationMs / 1000}s`,
            );
            this.circuitWasOpen = true;
          }
          return;
        }

        // Non-transient error for single item: discard it
        this.failed++;
        const count = failedByType.get(event.type) ?? 0;
        failedByType.set(event.type, count + 1);
      }
    }

    // Log aggregated failures
    if (failedByType.size > 0) {
      const totalFailed = Array.from(failedByType.values()).reduce((sum, count) => sum + count, 0);
      const summary = Array.from(failedByType.entries())
        .map(([type, count]) => `${type}=${count}`)
        .join(", ");
      this.logger.warn(`${totalFailed} eventos descartados por constraint: ${summary}`);
    }
  }

  private async drainQueue(): Promise<void> {
    while (!this.stopped && (this.inFlight || this.queue.size > 0)) {
      const batch = this.inFlight ?? this.flush();
      if (batch) await batch;
      else await new Promise((resolve) => setTimeout(resolve, Math.min(this.flushIntervalMs, 50)));
    }
  }

  private logDiscardedByType(events: DomainEvent[]): void {
    this.logger.warn(`descartados ${events.length} eventos: ${this.aggregateByType(events)}`);
  }

  private aggregateByType(events: DomainEvent[]): string {
    const counts = new Map<string, number>();
    for (const event of events) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => `${type}=${count}`)
      .join(", ");
  }
}
