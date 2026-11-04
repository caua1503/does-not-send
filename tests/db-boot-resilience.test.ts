import { describe, test, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { MigrationRunner } from "../src/db/migrate.js";

// Port 1 is reserved and never accepts connections: deterministic retry failure.
const UNREACHABLE_URL = "postgres://user:secret@127.0.0.1:1/nodb";

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

function captureLogger() {
  const info: string[] = [];
  const error: string[] = [];
  return { info, error, logger: { info: (m: string) => info.push(m), error: (m: string) => error.push(m) } };
}

describe("MigrationRunner background loop", () => {
  test("keeps retrying with exponential backoff and never throws", async () => {
    const { error, logger } = captureLogger();
    const runner = new MigrationRunner(UNREACHABLE_URL, { logger, initialDelayMs: 20 });

    runner.start();
    await Bun.sleep(500);

    expect(runner.isReady()).toBe(false);
    expect(error.length).toBeGreaterThanOrEqual(3);
    expect(error[0]).toContain("retrying in 20ms");
    expect(error[1]).toContain("retrying in 40ms");
    expect(error[2]).toContain("retrying in 80ms");
    // The connection string (and its password) must never reach the log.
    expect(error.join("\n")).not.toContain("secret");

    await runner.stop();
  });

  test("stop() exits promptly while a connection attempt is in flight", async () => {
    // 10.255.255.1 is non-routable: the connect hangs instead of being refused.
    const { logger } = captureLogger();
    const runner = new MigrationRunner("postgres://user:secret@10.255.255.1:5432/nodb", {
      logger,
    });
    runner.start();
    await Bun.sleep(100);

    const startedAt = Date.now();
    await runner.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(runner.isReady()).toBe(false);
  });

  test("isReady() only becomes true after a successful run", async () => {
    const { logger } = captureLogger();
    const runner = new MigrationRunner(UNREACHABLE_URL, { logger, initialDelayMs: 10 });
    expect(runner.isReady()).toBe(false);
    runner.start();
    await Bun.sleep(50);
    expect(runner.isReady()).toBe(false);
    await runner.stop();
  });
});

describe("App boot with database down", () => {
  test("boot completes, serves requests and dbReady() stays false", async () => {
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
    process.env.DATABASE_URL = UNREACHABLE_URL;

    const startedAt = Date.now();
    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      expect(Date.now() - startedAt).toBeLessThan(3000);

      const ctx = (app as unknown as { ctx: { dbReady(): boolean; migrationRunner?: unknown } }).ctx;
      expect(ctx.migrationRunner).toBeDefined();
      expect(ctx.dbReady()).toBe(false);

      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    } finally {
      const closedAt = Date.now();
      await app.close();
      expect(Date.now() - closedAt).toBeLessThan(2000);
    }
  });

  test("boot does not depend on the database being reachable", async () => {
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
    process.env.DATABASE_URL = "postgres://user:secret@127.0.0.1:1/other";

    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      const ctx = (app as unknown as { ctx: { dbReady(): boolean } }).ctx;
      expect(ctx.dbReady()).toBe(false);
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
