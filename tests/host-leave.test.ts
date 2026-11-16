import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { FakeClock } from "../src/session/clock.js";
import {
  cleanupTestApp,
  createMultipartPayload,
  createSession,
  createTestApp,
  getAppContext,
  type TestContext,
} from "./helpers.js";

type Message = Record<string, unknown>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitOpen(ws: WebSocket, timeout = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS open timeout")), timeout);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function collect(ws: WebSocket) {
  const messages: Message[] = [];
  let cursor = 0;
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as Message);
  });
  return {
    messages,
    async waitFor(predicate: (message: Message) => boolean, timeout = 3000): Promise<Message> {
      const deadline = Date.now() + timeout;
      while (true) {
        for (let i = cursor; i < messages.length; i++) {
          const message = messages[i]!;
          if (predicate(message)) {
            cursor = i + 1;
            return message;
          }
        }
        if (Date.now() > deadline) throw new Error("timeout waiting for WS message");
        await delay(20);
      }
    },
    count(predicate: (message: Message) => boolean): number {
      return messages.filter(predicate).length;
    },
  };
}

async function connect(
  baseUrl: string,
  sessionId: string,
  role: string,
  secret: string,
): Promise<{ ws: WebSocket; stream: ReturnType<typeof collect> }> {
  const ws = new WebSocket(`${baseUrl}/api/sessions/${sessionId}/ws`);
  await waitOpen(ws);
  const stream = collect(ws);
  ws.send(JSON.stringify({ type: "auth", role, secret }));
  await stream.waitFor((message) => message.type === "auth_ok");
  return { ws, stream };
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.close();
  await Promise.race([closed, delay(1000)]);
  // The server-side close handler runs after the client sees "close".
  await delay(100);
}

async function upload(
  ctx: TestContext,
  sessionId: string,
  credential: string,
  content: string,
  filename: string,
): Promise<void> {
  const { body, contentType } = createMultipartPayload([
    { name: "file", content: Buffer.from(content), filename },
  ]);
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/files`,
    headers: { authorization: `Bearer ${credential}`, "content-type": contentType },
    body,
  });
  expect(res.statusCode).toBe(201);
}

describe("saída do anfitrião encerra e apaga", () => {
  let ctx: TestContext;
  let baseUrl: string;
  let clock: FakeClock;

  beforeAll(async () => {
    clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const address = ctx.app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("twoway: host sai, todos recebem host_left, arquivos somem e o código morre", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { mode: "twoway", name: "Host" },
    });
    const session = created.json() as {
      id: string;
      ownerToken: string;
      qrToken: string;
      visualId: string;
    };

    const joinedAna = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Ana", device: "phone" },
    });
    const ana = joinedAna.json() as { participant: { id: string }; credential: string };

    await upload(ctx, session.id, ana.credential, "apagar", "apagar.txt");

    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);

    const store = getAppContext(ctx.app).sessionStore;
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/login-code`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const code = store.loginCodes.current(session.id)!.code;

    const leave = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(leave.statusCode).toBe(204);

    const closed = await anaWs.stream.waitFor((m) => m.type === "session:closed");
    expect(closed).toMatchObject({ type: "session:closed", reason: "host_left" });
    await hostWs.stream.waitFor((m) => m.type === "session:closed");

    const stored = store.getById(session.id)!;
    expect(stored.state).toBe("CLOSED");
    expect(stored.closedReason).toBe("host_left");
    expect(stored.files).toHaveLength(0);
    expect(stored.participants).toHaveLength(0);
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(false);

    const joinAfter = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Tarde", device: "phone" },
    });
    expect(joinAfter.statusCode).toBe(410);

    const codeAfter = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId: session.visualId, code },
    });
    expect(codeAfter.statusCode).toBe(410);

    await Promise.all([closeSocket(hostWs.ws), closeSocket(anaWs.ws)]);
  });

  it("oneway: host sai e o celular conectado recebe session_closed host_left", async () => {
    const session = await createSession(ctx.app);
    await upload(ctx, session.id, session.uploadToken, "oneway", "oneway.txt");

    const phoneWs = await connect(baseUrl, session.id, "phone", session.uploadToken);
    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);

    const leave = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(leave.statusCode).toBe(204);

    const closed = await phoneWs.stream.waitFor((m) => m.type === "session_closed");
    expect(closed).toMatchObject({ type: "session_closed", reason: "host_left" });
    await hostWs.stream.waitFor((m) => m.type === "session_closed");

    const store = getAppContext(ctx.app).sessionStore;
    expect(store.getById(session.id)!.state).toBe("CLOSED");
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(false);

    const reupload = await uploadOrFail(ctx, session.id, session.uploadToken);
    expect(reupload).toBe(410);

    await Promise.all([closeSocket(phoneWs.ws), closeSocket(hostWs.ws)]);
  });

  it("twoway: convidado sai, sessão e arquivos ficam e ele volta com o código", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { mode: "twoway", name: "Host" },
    });
    const session = created.json() as {
      id: string;
      ownerToken: string;
      qrToken: string;
      visualId: string;
    };
    const joinedAna = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Ana", device: "phone" },
    });
    const ana = joinedAna.json() as { participant: { id: string }; credential: string };
    await upload(ctx, session.id, ana.credential, "fica", "fica.txt");

    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);

    const leave = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(leave.statusCode).toBe(204);

    const left = await hostWs.stream.waitFor((m) => m.type === "participant:left");
    expect(left).toMatchObject({ type: "participant:left", id: ana.participant.id });

    const stillOpen = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(stillOpen.statusCode).toBe(200);
    expect(stillOpen.json().state).not.toBe("CLOSED");

    const files = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(files.json().files).toHaveLength(1);

    const anaAfter = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(anaAfter.statusCode).toBe(401);

    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/login-code`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const code = getAppContext(ctx.app).sessionStore.loginCodes.current(session.id)!.code;
    const rejoin = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { code, name: "Ana", device: "phone" },
    });
    expect(rejoin.statusCode).toBe(201);

    await Promise.all([closeSocket(hostWs.ws), closeSocket(anaWs.ws)]);
  });

  it("oneway: convidado sai, sessão e arquivos ficam e a credencial antiga morre", async () => {
    const session = await createSession(ctx.app, false);
    const pair = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    const phoneCredential = pair.json().phoneCredential as string;
    await upload(ctx, session.id, phoneCredential, "fica", "fica.txt");

    const leave = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${phoneCredential}` },
    });
    expect(leave.statusCode).toBe(204);

    const stillOpen = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(stillOpen.statusCode).toBe(200);

    const files = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(files.json().files).toHaveLength(1);

    expect(await uploadOrFail(ctx, session.id, phoneCredential)).toBe(401);

    const pairAgain = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pairAgain.statusCode).toBe(200);
    expect(pairAgain.json().phoneCredential).not.toBe(phoneCredential);
  });

  it("queda do host não encerra na hora; reconectar dentro da janela mantém a sessão", async () => {
    const session = await createSession(ctx.app);
    const phoneWs = await connect(baseUrl, session.id, "phone", session.uploadToken);
    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const store = getAppContext(ctx.app).sessionStore;

    await closeSocket(hostWs.ws);
    clock.advance(10_000);
    await store.tick();
    expect(store.getById(session.id)!.state).not.toBe("CLOSED");

    const hostAgain = await connect(baseUrl, session.id, "computer", session.ownerToken);
    clock.advance(30_000);
    await store.tick();
    expect(store.getById(session.id)!.state).not.toBe("CLOSED");

    await closeSocket(hostAgain.ws);
    clock.advance(25_000);
    await store.tick();

    const closed = await phoneWs.stream.waitFor((m) => m.type === "session_closed");
    expect(closed).toMatchObject({ reason: "host_disconnected" });
    expect(store.getById(session.id)!.state).toBe("CLOSED");
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(false);

    await closeSocket(phoneWs.ws);
  });

  it("sair duas vezes é idempotente e aborta upload em andamento sem deixar órfão", async () => {
    const session = await createSession(ctx.app);
    const store = getAppContext(ctx.app).sessionStore;
    const controller = new AbortController();
    store.registerUploadAbortController(session.id, controller);

    const dir = join(ctx.config.tempDir, session.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "orphan.bin"), "parcial");

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(controller.signal.aborted).toBe(true);
    expect(store.getById(session.id)!.state).toBe("CLOSED");
    expect(existsSync(dir)).toBe(false);
  });

  it("convidado não força encerramento fingindo ser anfitrião", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { mode: "twoway", name: "Host" },
    });
    const session = created.json() as {
      id: string;
      ownerToken: string;
      qrToken: string;
      visualId: string;
    };
    const joinedAna = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Ana", device: "phone" },
    });
    const ana = joinedAna.json() as { credential: string };

    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const leave = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/leave`,
      headers: { authorization: `Bearer ${ana.credential}` },
      payload: { role: "computer", secret: session.ownerToken },
    });
    expect(leave.statusCode).toBe(204);

    await hostWs.stream.waitFor((m) => m.type === "participant:left");
    expect(hostWs.stream.count((m) => m.type === "session:closed")).toBe(0);

    const stored = getAppContext(ctx.app).sessionStore.getById(session.id)!;
    expect(stored.state).not.toBe("CLOSED");

    const denied = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(denied.statusCode).toBe(401);

    await closeSocket(hostWs.ws);
  });
});

async function uploadOrFail(
  ctx: TestContext,
  sessionId: string,
  credential: string,
): Promise<number> {
  const { body, contentType } = createMultipartPayload([
    { name: "file", content: Buffer.from("x"), filename: "x.txt" },
  ]);
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/files`,
    headers: { authorization: `Bearer ${credential}`, "content-type": contentType },
    body,
  });
  return res.statusCode;
}
