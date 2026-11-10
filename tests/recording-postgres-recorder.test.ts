import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresRecorder, type Logger } from "../src/recording/postgres-recorder.js";
import type { Store } from "../src/recording/store.js";
import { ConstraintViolationError, isTransientError } from "../src/recording/store.js";
import type { DomainEvent } from "../src/recording/events.js";

// Helper: wait for condition with timeout
async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
  checkIntervalMs = 5,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }
}

// Mock logger
const logger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

// Mock isReady
let isReadyValue = true;
const isReady = (): boolean => isReadyValue;

// Mock store
class MockStore implements Store {
  calls: DomainEvent[][] = [];
  shouldFail: boolean | ((batch: DomainEvent[]) => boolean) = false;
  failWithConstraint: boolean = false;
  failWithTransient: boolean = false;
  delayMs = 0;

  async apply(events: DomainEvent[]): Promise<void> {
    this.calls.push([...events]);

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    const shouldFail =
      typeof this.shouldFail === "function" ? this.shouldFail(events) : this.shouldFail;

    if (shouldFail) {
      if (this.failWithConstraint) {
        throw new ConstraintViolationError("constraint violation", { code: "23505" });
      }
      if (this.failWithTransient) {
        throw Object.assign(new Error("connection error"), { code: "08006" });
      }
      throw new Error("generic error");
    }
  }

  reset(): void {
    this.calls = [];
    this.shouldFail = false;
    this.failWithConstraint = false;
    this.failWithTransient = false;
    this.delayMs = 0;
  }
}

describe("PostgresRecorder", () => {
  let store: MockStore;
  let recorder: PostgresRecorder;

  beforeEach(() => {
    store = new MockStore();
    isReadyValue = true;
    vi.clearAllMocks();
    recorder = new PostgresRecorder(store, isReady, logger, {
      flushIntervalMs: 10,
      circuitOpenDurationMs: 50,
      maxBatchSize: 100,
      maxQueueSize: 5000,
    });
  });

  it("preserves order: enqueues 3 events, flushes in order", async () => {
    const events: DomainEvent[] = [
      { type: "session_created", at: new Date(), sessionId: "1", visualId: "A" },
      { type: "session_paired", at: new Date(), sessionId: "1", phoneIp: "1.1.1.1" },
      { type: "session_closed", at: new Date(), sessionId: "1", reason: "closed" },
    ];

    for (const e of events) recorder.record(e);

    await waitFor(() => store.calls.length > 0, 200);

    expect(store.calls.length).toBe(1);
    expect(store.calls[0]).toEqual(events);
  }, 2000);

  it("record() does not throw when store fails", async () => {
    store.shouldFail = true;
    store.failWithTransient = true;

    const event: DomainEvent = {
      type: "session_created",
      at: new Date(),
      sessionId: "1",
      visualId: "A",
    };

    expect(() => recorder.record(event)).not.toThrow();
    await waitFor(() => store.calls.length > 0, 200);

    // Error handled internally, record() returned immediately
    expect(store.calls.length).toBeGreaterThan(0);
  }, 2000);

  it("circuit breaker opens after 3 failures and recovers after timeout", async () => {
    store.shouldFail = true;
    store.failWithTransient = true;

    const event: DomainEvent = {
      type: "session_created",
      at: new Date(),
      sessionId: "1",
      visualId: "A",
    };
    recorder.record(event);

    // Wait for 3 failures
    await waitFor(() => (logger.error as ReturnType<typeof vi.fn>).mock.calls.length > 0, 200);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("circuit open após 3 falhas"),
    );

    const callsBeforeRecovery = store.calls.length;

    // Store now succeeds
    store.shouldFail = false;

    // Wait for circuit to recover (50ms + some buffer)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have attempted again
    await waitFor(() => store.calls.length > callsBeforeRecovery, 200);
    expect(store.calls.length).toBeGreaterThan(callsBeforeRecovery);
  }, 2000);

  it("non-transient error triggers item-by-item, culprit discarded, rest committed", async () => {
    const events: DomainEvent[] = [
      { type: "session_created", at: new Date(), sessionId: "1", visualId: "A" },
      { type: "session_paired", at: new Date(), sessionId: "1", phoneIp: "1.1.1.1" }, // Poison
      { type: "session_closed", at: new Date(), sessionId: "1", reason: "closed" },
    ];

    // Batch of 3 fails with constraint, then item-by-item only session_paired fails
    store.shouldFail = (batch) => {
      if (batch.length === 3) return true; // Batch fails
      if (batch.length === 1 && batch[0]?.type === "session_paired") return true; // Poison fails
      return false;
    };
    store.failWithConstraint = true;

    for (const e of events) recorder.record(e);

    await waitFor(() => store.calls.length >= 4, 500); // 1 batch + 3 individual

    // Check that session_created and session_closed were committed
    const types = store.calls.flat().map((e) => e.type);
    expect(types).toContain("session_created");
    expect(types).toContain("session_closed");
    expect(recorder.stats().failed).toBe(1); // session_paired discarded
  }, 2000);

  it("discard by overflow: enqueue 5001 events quickly, oldest discarded", async () => {
    // Disable flush by making isReady false
    isReadyValue = false;

    for (let i = 0; i < 5001; i++) {
      recorder.record({
        type: "session_created",
        at: new Date(),
        sessionId: `${i}`,
        visualId: `V${i}`,
      });
    }

    // Check immediately
    const stats = recorder.stats();
    expect(stats.dropped).toBeGreaterThanOrEqual(1);
    expect(stats.queued).toBeLessThanOrEqual(5000);

    // Re-enable for cleanup
    isReadyValue = true;
  }, 2000);

  it("close() drains queue within timeout", async () => {
    for (let i = 0; i < 200; i++) {
      recorder.record({
        type: "session_created",
        at: new Date(),
        sessionId: `${i}`,
        visualId: `V${i}`,
      });
    }

    await recorder.close(2000);

    expect(recorder.stats().queued).toBe(0);
  }, 3000);

  it("close() respects timeout and discards remaining", async () => {
    store.delayMs = 100; // Each batch takes 100ms

    for (let i = 0; i < 300; i++) {
      recorder.record({
        type: "session_created",
        at: new Date(),
        sessionId: `${i}`,
        visualId: `V${i}`,
      });
    }

    await recorder.close(50); // Very short timeout

    expect(recorder.stats().dropped).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("close: timeout"));
  }, 2000);

  it("session_created and transfer_started both discarded by constraint without blocking rest", async () => {
    const events: DomainEvent[] = [
      { type: "session_created", at: new Date(), sessionId: "dup", visualId: "A" }, // Duplicate
      {
        type: "transfer_started",
        at: new Date(),
        id: "t1",
        sessionId: "nonexistent",
        name: "file.txt",
        extension: "txt",
        mime: "text/plain",
        category: "documents",
        size: 100,
      }, // FK violation
      { type: "session_closed", at: new Date(), sessionId: "other", reason: "closed" }, // Should succeed
    ];

    // Batch fails, then item-by-item first two fail
    store.shouldFail = (batch) => {
      if (batch.length === 3) return true; // Batch fails
      if (batch.length === 1 && batch[0]?.type === "session_created") return true;
      if (batch.length === 1 && batch[0]?.type === "transfer_started") return true;
      return false;
    };
    store.failWithConstraint = true;

    for (const e of events) recorder.record(e);

    await waitFor(() => store.calls.length >= 4, 500); // 1 batch + 3 individual

    // session_closed should be committed
    const types = store.calls.flat().map((e) => e.type);
    expect(types).toContain("session_closed");
    expect(recorder.stats().failed).toBe(2); // session_created + transfer_started
  }, 2000);
});

describe("isTransientError", () => {
  const wrapped = (cause: Record<string, unknown>): Error =>
    Object.assign(new Error("query failed"), { cause });

  it("trata conexão recusada (Drizzle envolve o erro do driver) como transitória", () => {
    // Que bug pega: Postgres fora no meio do upload descartava os eventos em vez de reenfileirar.
    expect(isTransientError(wrapped({ code: "ERR_POSTGRES_CONNECTION_REFUSED" }))).toBe(true);
    expect(isTransientError(wrapped({ errno: "08006" }))).toBe(true);
    expect(isTransientError({ code: "08006" })).toBe(true);
  });

  it("constraint e erro desconhecido não são transitórios", () => {
    expect(isTransientError(wrapped({ errno: "23503" }))).toBe(false);
    expect(isTransientError(new Error("boom"))).toBe(false);
  });
});
