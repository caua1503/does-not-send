import { describe, test, expect, beforeEach } from "vitest";
import {
  PostgresRecorder,
  type RecorderStore,
  type SessionRecorder,
} from "../src/recording/recorder.js";
import type { DomainEvent } from "../src/recording/events.js";

// Fake Store para testes
class FakeStore implements RecorderStore {
  public batches: DomainEvent[][] = [];
  public shouldFail: "connection" | "constraint" | "unknown" | null = null;
  public failCount = 0;
  public maxFails = 0;

  async apply(batch: DomainEvent[]): Promise<void> {
    if (this.shouldFail && this.failCount < this.maxFails) {
      this.failCount++;
      if (this.shouldFail === "connection") {
        throw new Error("connect ECONNREFUSED");
      } else if (this.shouldFail === "constraint") {
        throw new Error("duplicate key value violates unique constraint");
      } else {
        throw new Error("unknown error");
      }
    }

    this.batches.push([...batch]);
  }

  reset(): void {
    this.batches = [];
    this.shouldFail = null;
    this.failCount = 0;
    this.maxFails = 0;
  }
}

function createEvent(type: string, sessionId: string): DomainEvent {
  return {
    type: type as any,
    sessionId,
    timestamp: Date.now(),
  } as DomainEvent;
}

describe("PostgresRecorder - Queue", () => {
  let store: FakeStore;
  let recorder: SessionRecorder;

  beforeEach(() => {
    store = new FakeStore();
  });

  test("ordem preservada: eventos processados na ordem de chegada", async () => {
    recorder = new PostgresRecorder(store, {
      batchSize: 3,
      batchIntervalMs: 100,
    });

    recorder.record(createEvent("session_created", "s1"));
    recorder.record(createEvent("session_paired", "s1"));
    recorder.record(createEvent("transfer_started", "s1"));

    await Bun.sleep(200);

    expect(store.batches.length).toBe(1);
    expect(store.batches[0]?.length).toBe(3);
    expect(store.batches[0]![0]!.type).toBe("session_created");
    expect(store.batches[0]![1]!.type).toBe("session_paired");
    expect(store.batches[0]![2]!.type).toBe("transfer_started");

    await recorder.close();
  });

  test("lote: agrupa até batchSize ou intervalo", async () => {
    recorder = new PostgresRecorder(store, {
      batchSize: 3,
      batchIntervalMs: 100,
    });

    // Enviar 5 eventos: deve criar 2 lotes (3 + 2)
    for (let i = 0; i < 5; i++) {
      recorder.record(createEvent("session_created", `s${i}`));
    }

    await Bun.sleep(250);

    expect(store.batches.length).toBe(2);
    expect(store.batches[0]?.length).toBe(3);
    expect(store.batches[1]?.length).toBe(2);

    await recorder.close();
  });

  test("retry após falha de conexão com backoff", async () => {
    store.shouldFail = "connection";
    store.maxFails = 2;

    recorder = new PostgresRecorder(store, {
      batchSize: 2,
      batchIntervalMs: 100,
      maxBackoffMs: 2000,
    });

    recorder.record(createEvent("session_created", "s1"));
    recorder.record(createEvent("session_paired", "s1"));

    // Aguardar retry (1s + 2s de backoff máximo + margem)
    await Bun.sleep(4000);

    // Deve ter falhado 2x e depois ter sucesso
    expect(store.failCount).toBe(2);
    expect(store.batches.length).toBe(1);

    await recorder.close();
  });

  test("poison isolado: reprocessa item a item e descarta culpado", async () => {
    // Store falha apenas no segundo item
    class PoisonStore implements RecorderStore {
      public batches: DomainEvent[][] = [];
      async apply(batch: DomainEvent[]): Promise<void> {
        if (batch.length > 1) {
          throw new Error("duplicate key constraint");
        }
        // Se receber item isolado "s2", falha
        if (batch[0]?.sessionId === "s2") {
          throw new Error("duplicate key constraint");
        }
        this.batches.push([...batch]);
      }
    }

    const poisonStore = new PoisonStore();
    recorder = new PostgresRecorder(poisonStore, {
      batchSize: 3,
      batchIntervalMs: 100,
    });

    recorder.record(createEvent("session_created", "s1"));
    recorder.record(createEvent("session_created", "s2")); // poison
    recorder.record(createEvent("session_created", "s3"));

    await Bun.sleep(300);

    // Deve ter processado s1 e s3, descartado s2
    expect(poisonStore.batches.length).toBe(2);
    expect(poisonStore.batches[0]![0]!.sessionId).toBe("s1");
    expect(poisonStore.batches[1]![0]!.sessionId).toBe("s3");

    const stats = recorder.stats();
    expect(stats.failed).toBe(1); // s2 foi descartado

    await recorder.close();
  });

  test("descarte por estouro: remove o mais antigo ao atingir limite", async () => {
    recorder = new PostgresRecorder(store, {
      maxQueueSize: 5,
      batchSize: 10,
      batchIntervalMs: 5000, // Intervalo longo para acumular
    });

    // Enfileirar 7 eventos (limite 5)
    for (let i = 1; i <= 7; i++) {
      recorder.record(createEvent("session_created", `s${i}`));
    }

    const stats = recorder.stats();
    expect(stats.queued).toBe(7);
    expect(stats.dropped).toBe(2); // s1 e s2 descartados

    await recorder.close();

    // Após close(), deve ter processado apenas 5 eventos (s3 a s7)
    expect(store.batches.length).toBe(1);
    expect(store.batches[0]?.length).toBe(5);
    expect(store.batches[0]![0]!.sessionId).toBe("s3");
    expect(store.batches[0]![4]!.sessionId).toBe("s7");
  });

  test("close() drena fila com timeout de 5s", async () => {
    recorder = new PostgresRecorder(store, {
      batchSize: 2,
      batchIntervalMs: 10_000, // Intervalo muito longo
    });

    recorder.record(createEvent("session_created", "s1"));
    recorder.record(createEvent("session_paired", "s1"));
    recorder.record(createEvent("transfer_started", "s1"));

    // Fechar deve drenar imediatamente
    await recorder.close();

    expect(store.batches.length).toBeGreaterThan(0);
    const totalProcessed = store.batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalProcessed).toBe(3);
  });

  test(
    "close() respeita timeout de 5s se store travar",
    async () => {
    class SlowStore implements RecorderStore {
      async apply(_batch: DomainEvent[]): Promise<void> {
        await Bun.sleep(10_000); // 10s (maior que timeout de 5s)
      }
    }

    const slowStore = new SlowStore();
    recorder = new PostgresRecorder(slowStore, {
      batchSize: 1,
      batchIntervalMs: 100,
    });

    recorder.record(createEvent("session_created", "s1"));

    const start = Date.now();
    await recorder.close();
    const elapsed = Date.now() - start;

    // Deve ter respeitado timeout de ~5s (com margem de 500ms)
    expect(elapsed).toBeLessThan(5500);
    expect(elapsed).toBeGreaterThan(4500);
  }, 10_000); // timeout do teste: 10s
});
