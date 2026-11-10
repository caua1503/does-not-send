import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { SQL } from "bun";
import { eq } from "drizzle-orm";
import { MigrationRunner } from "../src/db/migrate.js";
import { sessions, transfers, events } from "../src/db/schema.js";
import { createDbClient, type DbClient } from "../src/db/client.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// The suite drops the public schema, so refuse anything that is not clearly a test DB.
const isDedicatedTestDb = databaseUrl !== undefined && /_test($|\?)/.test(databaseUrl);

describe.skipIf(!isDedicatedTestDb)("Database integration @db", () => {
  let client: DbClient;
  let sessionId: string;

  beforeAll(async () => {
    const setup = new SQL(databaseUrl!, { max: 1, connectionTimeout: 2 });
    try {
      // Drizzle keeps its journal in "drizzle"; dropping only "public" would
      // leave it claiming migrations that no longer exist.
      await setup`DROP SCHEMA IF EXISTS public CASCADE`;
      await setup`DROP SCHEMA IF EXISTS drizzle CASCADE`;
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

  test("@db migrates an empty database and inserts/selects in every table", async () => {
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
      // Beyond int4: fails if the column is not bigint / mode is wrong.
      size: 5_000_000_000,
      status: "completed",
      startedAt: new Date().toISOString(),
    });
    await client.writer.insert(events).values({
      type: "pairing_refused",
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
    expect(eventRows[0]?.type).toBe("pairing_refused");
  });

  test("@db app exposes db.isReady() true once migrations finish", async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      const ctx = (app as unknown as { ctx: { db?: { isReady(): boolean } } }).ctx;
      const deadline = Date.now() + 15_000;
      while (!ctx.db?.isReady() && Date.now() < deadline) await Bun.sleep(50);
      expect(ctx.db?.isReady()).toBe(true);
    } finally {
      await app.close();
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    }
  });

  test("@db deleting a session cascades its transfers", async () => {
    await client.writer.delete(sessions).where(eq(sessions.id, sessionId));
    const orphanTransfers = await client.reader
      .select()
      .from(transfers)
      .where(eq(transfers.sessionId, sessionId));
    expect(orphanTransfers).toHaveLength(0);
  });
});
