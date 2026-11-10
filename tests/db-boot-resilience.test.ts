import { describe, test, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { MigrationRunner, isRetryable } from "../src/db/migrate.js";

type Ctx = { db?: { isReady(): boolean } };

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
  return {
    info,
    error,
    logger: { info: (m: string) => info.push(m), error: (m: string) => error.push(m) },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(10);
}

describe("isRetryable", () => {
  test("permanent SQLSTATE (syntax/schema/auth) is not retried", () => {
    expect(isRetryable(Object.assign(new Error("undefined_table"), { code: "42P01" }))).toBe(false);
    expect(isRetryable(Object.assign(new Error("invalid_password"), { code: "28P01" }))).toBe(false);
  });

  test("network failure is retried, including via cause", () => {
    expect(isRetryable(Object.assign(new Error("connect"), { code: "08S01" }))).toBe(true);
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("cannot_connect_now"), { code: "57P03" }),
    });
    expect(isRetryable(wrapped)).toBe(true);
    const wrappedConn = new Error("query failed", {
      cause: Object.assign(new Error("conn"), { code: "ERR_POSTGRES_CONNECTION_REFUSED" }),
    });
    expect(isRetryable(wrappedConn)).toBe(true);
    const permanentWrapped = new Error("migrate failed", {
      cause: Object.assign(new Error("undefined_table"), { code: "42P01" }),
    });
    expect(isRetryable(permanentWrapped)).toBe(false);
  });

  test("error without a SQLSTATE is retried", () => {
    expect(isRetryable(new Error("boom"))).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
  });
});

describe("MigrationRunner background loop", () => {
  test("keeps retrying with exponential backoff and never throws", async () => {
    const { error, logger } = captureLogger();
    const runner = new MigrationRunner(UNREACHABLE_URL, { logger, initialDelayMs: 20 });

    runner.start();
    await waitFor(() => error.length >= 3, 3000);

    expect(runner.isReady()).toBe(false);
    expect(error[0]).toContain("retrying in 20ms");
    expect(error[1]).toContain("retrying in 40ms");
    expect(error[2]).toContain("retrying in 80ms");
    // The password must never reach the log, whatever the driver message says.
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

  test("stop() during backoff prevents any further attempt", async () => {
    const { error, logger } = captureLogger();
    const runner = new MigrationRunner(UNREACHABLE_URL, { logger, initialDelayMs: 2000 });
    runner.start();
    await waitFor(() => error.length >= 1, 3000);
    expect(error).toHaveLength(1);

    await runner.stop();
    await Bun.sleep(300);
    expect(error).toHaveLength(1);
    expect(runner.isReady()).toBe(false);
  });
});

describe("App boot with database down", () => {
  test("boot completes, serves requests and db.isReady() stays false", async () => {
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
    process.env.DATABASE_URL = UNREACHABLE_URL;

    const startedAt = Date.now();
    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      expect(Date.now() - startedAt).toBeLessThan(3000);

      const ctx = (app as unknown as { ctx: Ctx }).ctx;
      expect(ctx.db).toBeDefined();
      expect(ctx.db!.isReady()).toBe(false);

      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    } finally {
      const closedAt = Date.now();
      await app.close();
      expect(Date.now() - closedAt).toBeLessThan(2000);
    }
  });

  test("database feature is inert without DATABASE_URL", async () => {
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
    delete process.env.DATABASE_URL;

    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      const ctx = (app as unknown as { ctx: Ctx }).ctx;
      expect(ctx.db).toBeUndefined();
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
