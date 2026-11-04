/**
 * Session Recorder — Interface e Implementações
 * 
 * SessionRecorder: interface síncrona record(event)
 * RecorderStore: interface apply(batch) assíncrona para persistência
 * PostgresRecorder: fila com worker único, lotes, retry, poison handling
 * InMemoryRecorder: implementação in-memory para testes
 */

import type { DomainEvent } from "./events.js";

export interface SessionRecorder {
  record(event: DomainEvent): void;
  stats(): { queued: number; dropped: number; failed: number };
  close(): Promise<void>;
}

export interface RecorderStore {
  apply(batch: DomainEvent[]): Promise<void>;
}

interface QueueStats {
  queued: number;
  dropped: number;
  failed: number;
}

export class PostgresRecorder implements SessionRecorder {
  private queue: DomainEvent[] = [];
  private stats_: QueueStats = { queued: 0, dropped: 0, failed: 0 };
  private worker: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private closed = false;

  constructor(
    private store: RecorderStore,
    private options: {
      maxQueueSize?: number;
      batchSize?: number;
      batchIntervalMs?: number;
      maxBackoffMs?: number;
    } = {},
  ) {
    const maxQueueSize = options.maxQueueSize ?? 10_000;
    const batchIntervalMs = options.batchIntervalMs ?? 500;

    this.worker = setInterval(() => {
      if (!this.processing && this.queue.length > 0) {
        void this.processBatch();
      }
    }, batchIntervalMs);
  }

  record(event: DomainEvent): void {
    if (this.closed) return;

    const maxQueueSize = this.options.maxQueueSize ?? 10_000;

    if (this.queue.length >= maxQueueSize) {
      // Descarta o mais antigo
      this.queue.shift();
      this.stats_.dropped++;
    }

    this.queue.push(event);
    this.stats_.queued++;
  }

  stats(): QueueStats {
    return { ...this.stats_ };
  }

  async close(): Promise<void> {
    this.closed = true;

    if (this.worker) {
      clearInterval(this.worker);
      this.worker = null;
    }

    // Drena fila com timeout de 5s
    const deadline = Date.now() + 5000;
    while (this.queue.length > 0 && Date.now() < deadline) {
      if (!this.processing) {
        // Lançar processamento sem await, mas aguardar com race contra deadline
        const processPromise = this.processBatch();
        const timeoutPromise = new Promise<void>((resolve) => {
          const remaining = deadline - Date.now();
          setTimeout(resolve, Math.max(0, remaining));
        });
        await Promise.race([processPromise, timeoutPromise]);
        
        if (Date.now() >= deadline) break;
      } else {
        await Bun.sleep(50);
        if (Date.now() >= deadline) break;
      }
    }
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const batchSize = this.options.batchSize ?? 100;
    const batch = this.queue.splice(0, batchSize);

    let backoffMs = 1000;
    const maxBackoffMs = this.options.maxBackoffMs ?? 30_000;

    while (true) {
      try {
        await this.store.apply(batch);
        this.processing = false;
        return;
      } catch (err) {
        // Erro de conexão: retry com backoff
        if (this.isConnectionError(err)) {
          await Bun.sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
          continue;
        }

        // Erro de constraint: reprocessar item a item
        if (this.isConstraintError(err)) {
          await this.reprocessItemByItem(batch);
          this.processing = false;
          return;
        }

        // Erro desconhecido: logar e descartar lote
        console.error("PostgresRecorder: unknown error, discarding batch", {
          error: String(err),
          batchSize: batch.length,
        });
        this.stats_.failed += batch.length;
        this.processing = false;
        return;
      }
    }
  }

  private async reprocessItemByItem(batch: DomainEvent[]): Promise<void> {
    for (const event of batch) {
      try {
        await this.store.apply([event]);
      } catch (err) {
        // Item poison: descartar e logar sem dados sensíveis
        console.error("PostgresRecorder: poison item discarded", {
          type: event.type,
          sessionId: event.sessionId,
          error: String(err),
        });
        this.stats_.failed++;
      }
    }
  }

  private isConnectionError(err: unknown): boolean {
    const msg = String(err).toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("connection") ||
      msg.includes("timeout")
    );
  }

  private isConstraintError(err: unknown): boolean {
    const msg = String(err).toLowerCase();
    return (
      msg.includes("constraint") ||
      msg.includes("duplicate") ||
      msg.includes("violates")
    );
  }
}

export class InMemoryRecorder implements SessionRecorder {
  public events: DomainEvent[] = [];
  private stats_: QueueStats = { queued: 0, dropped: 0, failed: 0 };

  record(event: DomainEvent): void {
    this.events.push(event);
    this.stats_.queued++;
  }

  stats(): QueueStats {
    return { ...this.stats_ };
  }

  async close(): Promise<void> {
    // No-op para in-memory
  }

  clear(): void {
    this.events = [];
    this.stats_ = { queued: 0, dropped: 0, failed: 0 };
  }
}
