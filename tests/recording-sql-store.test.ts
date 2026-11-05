import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlStore } from "../src/recording/sql-store.js";
import { createDbClient } from "../src/db/client.js";
import { MigrationRunner } from "../src/db/migrate.js";
import type { DomainEvent } from "../src/recording/events.js";
import type { Logger } from "../src/recording/store.js";
import * as schema from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const logger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

describe.skipIf(!TEST_DATABASE_URL)("SqlStore @db", () => {
  if (!TEST_DATABASE_URL) return;

  let db: ReturnType<typeof createDbClient>;
  let migrator: MigrationRunner;
  let store: SqlStore;

  beforeEach(async () => {
    db = createDbClient(TEST_DATABASE_URL);
    migrator = new MigrationRunner(TEST_DATABASE_URL, { logger });
    migrator.start();

    // Wait for migrations
    for (let i = 0; i < 50; i++) {
      if (migrator.isReady()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!migrator.isReady()) {
      throw new Error("Migrations did not complete in time");
    }

    // Clean tables
    await db.writer.delete(schema.events);
    await db.writer.delete(schema.transfers);
    await db.writer.delete(schema.sessions);

    store = new SqlStore(db.writer, logger);
  });

  afterEach(async () => {
    await migrator.stop();
    await db.close();
  });

  it("complete flow: session created → paired → transfers → closed", async () => {
    const now = new Date();
    const events: DomainEvent[] = [
      {
        type: "session_created",
        at: now,
        sessionId: "s1",
        visualId: "ABC-123",
        computerIp: "::ffff:192.168.1.1",
      },
      { type: "session_paired", at: now, sessionId: "s1", phoneIp: "10.0.0.1" },
      {
        type: "transfer_started",
        at: now,
        id: "t1",
        sessionId: "s1",
        name: "file.txt",
        extension: "txt",
        mime: "text/plain",
        category: "documents",
        size: 1000,
      },
      { type: "transfer_finished", at: now, id: "t1", status: "completed", size: 1000 },
      {
        type: "transfer_started",
        at: now,
        id: "t2",
        sessionId: "s1",
        name: "image.jpg",
        extension: "jpg",
        mime: "image/jpeg",
        category: "images",
        size: 5000,
      },
      { type: "transfer_finished", at: now, id: "t2", status: "failed", size: 0 },
      { type: "pairing_refused", at: now, ip: "1.2.3.4", sessionId: "s1" },
      { type: "session_closed", at: now, sessionId: "s1", reason: "closed" },
    ];

    await store.apply(events);

    // Verify session
    const sessions = await db.reader.select().from(schema.sessions).where(eq(schema.sessions.id, "s1"));
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.visualId).toBe("ABC-123");
    expect(sessions[0]?.computerIp).toBe("192.168.1.1"); // normalized
    expect(sessions[0]?.phoneIp).toBe("10.0.0.1");
    expect(sessions[0]?.closedAt).toBeTruthy();
    expect(sessions[0]?.closeReason).toBe("closed");

    // Verify transfers
    const transfers = await db.reader
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.sessionId, "s1"));
    expect(transfers.length).toBe(2);

    const t1 = transfers.find((t) => t.id === "t1");
    expect(t1?.status).toBe("completed");
    expect(t1?.size).toBe(1000);

    const t2 = transfers.find((t) => t.id === "t2");
    expect(t2?.status).toBe("failed");
    expect(t2?.size).toBe(0);

    // Verify event
    const eventsFromDb = await db.reader.select().from(schema.events);
    expect(eventsFromDb.length).toBe(1);
    expect(eventsFromDb[0]?.type).toBe("pairing_refused");
    expect(eventsFromDb[0]?.ip).toBe("1.2.3.4");
  });

  it("idempotency: session_created twice inserts only once", async () => {
    const now = new Date();
    const events: DomainEvent[] = [
      { type: "session_created", at: now, sessionId: "s1", visualId: "ABC-123" },
      { type: "session_created", at: now, sessionId: "s1", visualId: "XYZ-999" }, // Duplicate, ignored
    ];

    await store.apply(events);

    const sessions = await db.reader.select().from(schema.sessions).where(eq(schema.sessions.id, "s1"));
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.visualId).toBe("ABC-123"); // First one wins
  });

  it("idempotency: transfer_finished twice does not change status", async () => {
    const now = new Date();
    const events: DomainEvent[] = [
      { type: "session_created", at: now, sessionId: "s1", visualId: "ABC-123" },
      {
        type: "transfer_started",
        at: now,
        id: "t1",
        sessionId: "s1",
        name: "file.txt",
        extension: "txt",
        mime: "text/plain",
        category: "documents",
        size: 1000,
      },
      { type: "transfer_finished", at: now, id: "t1", status: "completed", size: 1000 },
    ];

    await store.apply(events);

    // Try to finish again with different status
    await store.apply([
      { type: "transfer_finished", at: now, id: "t1", status: "failed", size: 0 },
    ]);

    const transfers = await db.reader.select().from(schema.transfers).where(eq(schema.transfers.id, "t1"));
    expect(transfers.length).toBe(1);
    expect(transfers[0]?.status).toBe("completed"); // First finish wins
    expect(transfers[0]?.size).toBe(1000);
  });

  it("constraint violation: transfer_started with nonexistent sessionId throws ConstraintViolationError", async () => {
    const now = new Date();
    const event: DomainEvent = {
      type: "transfer_started",
      at: now,
      id: "t1",
      sessionId: "nonexistent",
      name: "file.txt",
      extension: "txt",
      mime: "text/plain",
      category: "documents",
      size: 1000,
    };

    await expect(store.apply([event])).rejects.toThrow("Constraint violation");
  });
});
