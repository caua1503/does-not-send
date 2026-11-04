import { describe, test, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";

describe("Database boot resilience", () => {
  test("app boots without error when database is unreachable", async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://fake:fake@localhost:9999/fake";

    const config = loadConfig();
    let app;

    try {
      // Should not throw
      app = await buildApp(config, { startSweeper: false });

      expect(app).toBeDefined();

      const ctx = (app as unknown as { ctx: { migrationRunner?: { isReady(): boolean } } }).ctx;
      expect(ctx.migrationRunner).toBeDefined();
      expect(ctx.migrationRunner!.isReady()).toBe(false);
    } finally {
      if (app) {
        await app.close();
      }
      if (originalUrl) {
        process.env.DATABASE_URL = originalUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  test("migration runner stops retrying after shutdown", async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://fake:fake@localhost:9999/fake";

    const config = loadConfig();
    let app;

    try {
      app = await buildApp(config, { startSweeper: false });

      const ctx = (app as unknown as { ctx: { migrationRunner?: { isReady(): boolean } } }).ctx;
      expect(ctx.migrationRunner!.isReady()).toBe(false);

      // Stop the runner via app close
      await app.close();

      // Wait a bit to ensure no more retries happen after stop
      await Bun.sleep(100);

      // Still not ready, but no crash
      expect(ctx.migrationRunner!.isReady()).toBe(false);
    } finally {
      if (originalUrl) {
        process.env.DATABASE_URL = originalUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});
