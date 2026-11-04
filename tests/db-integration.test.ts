import { describe, test, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sessions, transfers, events } from "../src/db/schema.js";

// @db
describe("Database integration", { skip: !process.env.TEST_DATABASE_URL }, () => {
  const dbUrl = process.env.TEST_DATABASE_URL!;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(dbUrl, { max: 1 });
    const db = drizzle(sql);

    // Run migrations on empty database
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await sql.end({ timeout: 1 });
  });

  test("inserts and selects session", async () => {
    const db = drizzle(sql);
    const sessionId = `test-${Date.now()}`;

    await db.insert(sessions).values({
      id: sessionId,
      visualId: "ABC-123",
      computerIp: "192.168.1.1",
      phoneIp: "192.168.1.2",
      pairedAt: new Date().toISOString(),
    });

    const result = await db.select().from(sessions).where(sessions.id.eq(sessionId));
    expect(result).toHaveLength(1);
    expect(result[0].visualId).toBe("ABC-123");
  });

  test("inserts and selects transfer", async () => {
    const db = drizzle(sql);
    const sessionId = `test-${Date.now()}`;
    const transferId = `transfer-${Date.now()}`;

    await db.insert(sessions).values({
      id: sessionId,
      visualId: "XYZ-456",
    });

    await db.insert(transfers).values({
      id: transferId,
      sessionId,
      name: "test.pdf",
      extension: "pdf",
      mime: "application/pdf",
      category: "pdfs",
      size: 1024,
      status: "completed",
    });

    const result = await db.select().from(transfers).where(transfers.id.eq(transferId));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test.pdf");
    expect(result[0].category).toBe("pdfs");
  });

  test("inserts and selects event", async () => {
    const db = drizzle(sql);
    const eventIp = `127.0.0.${Date.now() % 255}`;

    await db.insert(events).values({
      type: "qr_reused",
      ip: eventIp,
    });

    const result = await db.select().from(events).where(events.ip.eq(eventIp));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("qr_reused");
  });
});
