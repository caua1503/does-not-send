import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Writable } from "node:stream";
import { WebSocket } from "ws";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";

const QR_SECRET = "SEGREDO1";
const TOKEN_SECRET = "SEGREDO2";
const BEARER_SECRET = "SEGREDO3";

describe("log redaction", () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  let ctx: TestContext;
  let httpUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    ctx = await createTestApp(undefined, { startSweeper: false, loggerStream: sink });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const origin = ctx.app.listeningOrigin;
    httpUrl = origin;
    wsUrl = origin.replace("http://", "ws://");
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("samples hot-path successes and retains failed requests without query tokens", async () => {
    const start = lines.length;
    for (let i = 0; i < 12; i++) {
      expect((await ctx.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
    expect((await ctx.app.inject({
      method: "POST", url: `/api/sessions/missing/heartbeat?token=${TOKEN_SECRET}`,
    })).statusCode).toBe(401);
    const records = lines.slice(start).map((line) => JSON.parse(line));
    expect(records.filter((entry) => entry.req?.url === "/health").length).toBeLessThan(12);
    expect(records).toContainEqual(expect.objectContaining({
      req: { method: "POST", url: "/api/sessions/missing/heartbeat" },
      statusCode: 401,
    }));
    expect(lines.slice(start).join("")).not.toContain(TOKEN_SECRET);
  });

  it("never logs qrToken, token or Authorization", async () => {
    const res = await fetch(
      `${httpUrl}/api/sessions/unknown/pair?qrToken=${QR_SECRET}&token=${TOKEN_SECRET}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${BEARER_SECRET}` },
      },
    );
    expect(res.status).toBe(404);

    const ws = new WebSocket(
      `${wsUrl}/api/sessions/unknown/ws?qrToken=${QR_SECRET}&token=${TOKEN_SECRET}`,
      {
        headers: { authorization: `Bearer ${BEARER_SECRET}` },
      },
    );
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.once("error", () => resolve());
    });

    const output = lines.join("");
    expect(output).toContain("/api/sessions/unknown/pair");
    expect(output).toContain("/api/sessions/unknown/ws");
    for (const secret of [QR_SECRET, TOKEN_SECRET, BEARER_SECRET]) {
      expect(output).not.toContain(secret);
    }
  });
});
