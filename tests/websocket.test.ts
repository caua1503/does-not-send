import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  uploadFile,
  type TestContext,
} from "./helpers.js";
import { WebSocket } from "ws";

function waitForOpen(ws: WebSocket, timeout = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS open timeout")), timeout);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", reject);
  });
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
      const parsed = JSON.parse(data.toString());
      if (parsed.type !== "auth_ok") {
        msgs.push(parsed);
      }
      if (msgs.length >= count) {
        clearTimeout(t);
        resolve(msgs);
      }
    });
  });
}

async function wsConnectAndAuth(
  baseUrl: string,
  sessionId: string,
  role: "computer" | "phone",
  secret: string,
): Promise<WebSocket> {
  const ws = new WebSocket(`${baseUrl}/api/sessions/${sessionId}/ws`);
  await waitForOpen(ws);

  const authPromise = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("auth timeout")), 3000);
    const onMsg = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok") {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve();
      }
    };
    ws.on("message", onMsg);
    ws.once("close", (code) => {
      clearTimeout(t);
      ws.off("message", onMsg);
      reject(new Error(`ws closed before auth_ok: ${code}`));
    });
  });

  ws.send(JSON.stringify({ type: "auth", role, secret }));
  await authPromise;
  return ws;
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

  it("rejects connection for nonexistent session (4001 close)", async () => {
    const ws = new WebSocket(`${baseUrl}/api/sessions/fake-id/ws`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("rejects connection with invalid auth secret (4001 close)", async () => {
    const session = await createSession(ctx.app);
    const ws = new WebSocket(`${baseUrl}/api/sessions/${session.id}/ws`);
    await waitForOpen(ws);
    const closePromise = waitForClose(ws);
    ws.send(JSON.stringify({ type: "auth", role: "computer", secret: "invalid-secret" }));
    const { code } = await closePromise;
    expect(code).toBe(4001);
  });

  it("rejects connection if first message is not auth (4001 close)", async () => {
    const session = await createSession(ctx.app);
    const ws = new WebSocket(`${baseUrl}/api/sessions/${session.id}/ws`);
    await waitForOpen(ws);
    const closePromise = waitForClose(ws);
    ws.send(JSON.stringify({ type: "heartbeat" }));
    const { code } = await closePromise;
    expect(code).toBe(4001);
  });

  it("accepts connection with computer auth", async () => {
    const session = await createSession(ctx.app);
    const ws = await wsConnectAndAuth(baseUrl, session.id, "computer", session.ownerToken);
    ws.close();
    await waitForClose(ws);
  });

  it("accepts connection with phone auth", async () => {
    const session = await createSession(ctx.app);
    const ws = await wsConnectAndAuth(baseUrl, session.id, "phone", session.uploadToken);
    ws.close();
    await waitForClose(ws);
  });

  it("receives file events in order: receiving → progress → completed", async () => {
    const session = await createSession(ctx.app);
    const ws = await wsConnectAndAuth(baseUrl, session.id, "computer", session.ownerToken);

    // Upload happens after WS is authenticated
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

  it("closes WebSocket when session is closed", async () => {
    const session = await createSession(ctx.app);
    const ws = await wsConnectAndAuth(baseUrl, session.id, "computer", session.ownerToken);

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
    const ws = await wsConnectAndAuth(baseUrl, session.id, "computer", session.ownerToken);

    // Count before disconnect
    const { fileEvents } = await import("../src/utils/events.js");
    const countBefore = fileEvents.listenerCount(`file:state-changed:${session.id}`);

    ws.close(1000);
    await waitForClose(ws);

    // Short delay for cleanup
    await new Promise((r) => setTimeout(r, 100));

    const countAfter = fileEvents.listenerCount(`file:state-changed:${session.id}`);
    expect(countAfter).toBeLessThan(countBefore + 1);
    expect(countAfter).toBe(0);
  });
});
