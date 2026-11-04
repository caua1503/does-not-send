import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { SQL } from "bun";
import { eq } from "drizzle-orm";
import { MigrationRunner } from "../src/db/migrate.js";
import { sessions, transfers, events } from "../src/db/schema.js";
import { createDbClient, type DbClient } from "../src/db/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

// @db
describe.skipIf(!databaseUrl)("Database integration", () => {
  let client: DbClient;
  let sessionId: string;

  beforeAll(async () => {
    const setup = new SQL(databaseUrl!, { max: 1 });
    try {
      await setup`DROP SCHEMA IF EXISTS public CASCADE`;
      await setup`CREATE SCHEMA public`;
    } finally {
      await setup.close({ timeout: 5 });
    }

    const runner = new MigrationRunner(databaseUrl!, {
      logger: { info: () => {}, error: () => {} },
    });
    runner.start();
    const deadline = Date.now() + 15_000;
    while (!runner.isReady() && Date.now() < deadline) await Bun.sleep(50);
    await runner.stop();
    expect(runner.isReady()).toBe(true);

    client = createDbClient(databaseUrl!);
  });

  afterAll(async () => {
    await client?.close();
  });

  test("schema is usable by the writer pool (insert + select on every table)", async () => {
    sessionId = crypto.randomUUID();
    await client.writer.insert(sessions).values({
      id: sessionId,
      visualId: "ABC-123",
      computerIp: "192.168.1.1",
      createdAt: new Date().toISOString(),
    });
    await client.writer.insert(transfers).values({
      id: crypto.randomUUID(),
      sessionId,
      name: "doc.pdf",
      extension: "pdf",
      mime: "application/pdf",
      category: "pdfs",
      size: 5_000_000_000, // beyond int4: exercises bigint mode "number"
      status: "completed",
      startedAt: new Date().toISOString(),
    });
    await client.writer.insert(events).values({
      type: "qr_reused",
      ip: "127.0.0.1",
      sessionId,
      at: new Date().toISOString(),
    });

    const [session] = await client.reader.select().from(sessions).where(eq(sessions.id, sessionId));
    const transferRows = await client.reader
      .select()
      .from(transfers)
      .where(eq(transfers.sessionId, sessionId));
    const eventRows = await client.reader
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId));

    expect(session?.visualId).toBe("ABC-123");
    expect(transferRows[0]?.size).toBe(5_000_000_000);
    expect(typeof eventRows[0]?.id).toBe("number");
    expect(eventRows[0]?.type).toBe("qr_reused");
  });

  test("deleting a session cascades its transfers", async () => {
    await client.writer.delete(sessions).where(eq(sessions.id, sessionId));
    const orphanTransfers = await client.reader
      .select()
      .from(transfers)
      .where(eq(transfers.sessionId, sessionId));
    expect(orphanTransfers).toHaveLength(0);
  });
});
