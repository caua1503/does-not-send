import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  uploadFile,
  type TestContext,
} from "./helpers.js";
import { WebSocket } from "ws";

function wsConnect(baseUrl: string, sessionId: string, token: string): WebSocket {
  const url = `${baseUrl}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`;
  return new WebSocket(url);
}

function waitForClose(ws: WebSocket, timeout = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for WS close")), timeout);
    ws.once("close", (code, reason) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function collectMessages(ws: WebSocket, count: number, timeout = 5000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const msgs: unknown[] = [];
    const t = setTimeout(
      () => reject(new Error(`timeout: got ${msgs.length}/${count} messages`)),
      timeout,
    );
    ws.on("message", (data) => {
      msgs.push(JSON.parse(data.toString()));
      if (msgs.length >= count) {
        clearTimeout(t);
        resolve(msgs);
      }
    });
  });
}

describe("websocket", () => {
  let ctx: TestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = ctx.app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("rejects connection without token (401 close)", async () => {
    const ws = new WebSocket(`${baseUrl}/api/sessions/fake-id/ws`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("rejects connection with invalid token (401 close)", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, "invalid-token-" + "x".repeat(50));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("rejects connection with upload token (owner only)", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, session.uploadToken);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("accepts connection with owner token", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, session.ownerToken);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout connecting")), 3000);
      ws.on("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.on("error", reject);
    });

    ws.close();
    await waitForClose(ws);
  });

  it("receives file events in order: receiving → progress → completed", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, session.ownerToken);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("WS open timeout")), 3000);
      ws.on("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.on("error", reject);
    });

    // Upload happens after WS is open
    const msgsPromise = collectMessages(ws, 3, 5000);
    await uploadFile(ctx.app, session, "hello world", "test.txt");

    const msgs = (await msgsPromise) as Array<{ type: string; state?: string }>;

    // receiving → (at least one progress) → completed
    expect(msgs[0]).toMatchObject({ type: "file:state-changed", state: "receiving" });
    const last = msgs[msgs.length - 1] as { type: string; state?: string };
    expect(last).toMatchObject({ type: "file:state-changed", state: "completed" });

    ws.close();
    await waitForClose(ws);
  });

  it("isolates events between sessions (session A does not receive session B events)", async () => {
    const sessionA = await createSession(ctx.app);
    const sessionB = await createSession(ctx.app);

    const wsA = wsConnect(baseUrl, sessionA.id, sessionA.ownerToken);
    await new Promise<void>((resolve) => wsA.on("open", resolve));

    const receivedByA: unknown[] = [];
    wsA.on("message", (d) => receivedByA.push(JSON.parse(d.toString())));

    // Upload to session B only
    await uploadFile(ctx.app, sessionB, "data for B", "b.txt");

    // Wait a bit for any spurious messages
    await new Promise((r) => setTimeout(r, 300));

    expect(receivedByA).toHaveLength(0);

    wsA.close();
    await waitForClose(wsA);
  });

  it("closes WebSocket when session is closed", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, session.ownerToken);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    const closePromise = waitForClose(ws, 3000);

    // Close session via HTTP
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    const { code } = await closePromise;
    expect(code).toBe(4000); // session closed
  });

  it("disconnecting client releases listeners (no leak)", async () => {
    const session = await createSession(ctx.app);
    const ws = wsConnect(baseUrl, session.id, session.ownerToken);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Count before disconnect
    const { fileEvents } = await import("../src/utils/events.js");
    const countBefore = fileEvents.listenerCount(`file:state-changed:${session.id}`);

    ws.close(1000);
    await waitForClose(ws);

    // Short delay for cleanup
    await new Promise((r) => setTimeout(r, 100));

    const countAfter = fileEvents.listenerCount(`file:state-changed:${session.id}`);
    expect(countAfter).toBeLessThan(countBefore + 1);
    // The listener added by this WS should be gone
    expect(countAfter).toBe(0);
  });
});
