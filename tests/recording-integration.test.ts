import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import type { FastifyInstance } from "fastify";
import { NoopRecorder, PostgresRecorder } from "../src/recording/index.js";

describe("Recorder integration", () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("uses NoopRecorder when DATABASE_URL is not set", async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const config = loadConfig();
      app = await buildApp(config, { startSweeper: false });
      ctx = (app as unknown as { ctx: AppContext }).ctx;

      expect(ctx.recorder).toBeInstanceOf(NoopRecorder);
      expect(ctx.recorder.stats()).toEqual({ queued: 0, dropped: 0, failed: 0 });

      // record() should not throw
      expect(() =>
        ctx.recorder.record({
          type: "session_created",
          at: new Date(),
          sessionId: "test",
          visualId: "TEST-123",
        }),
      ).not.toThrow();
    } finally {
      if (originalUrl) process.env.DATABASE_URL = originalUrl;
    }
  });

  it("uses PostgresRecorder when DATABASE_URL is set", async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";

    try {
      const config = loadConfig();
      app = await buildApp(config, { startSweeper: false });
      ctx = (app as unknown as { ctx: AppContext }).ctx;

      expect(ctx.recorder).toBeInstanceOf(PostgresRecorder);

      // record() should not throw (even though DB might not be available)
      expect(() =>
        ctx.recorder.record({
          type: "session_created",
          at: new Date(),
          sessionId: "test",
          visualId: "TEST-123",
        }),
      ).not.toThrow();
    } finally {
      if (originalUrl !== undefined) {
        process.env.DATABASE_URL = originalUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});
