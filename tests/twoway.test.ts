import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { PassThrough } from "node:stream";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { FakeClock } from "../src/session/clock.js";
import {
  cleanupTestApp,
  createMultipartPayload,
  createTestApp,
  getAppContext,
  type TestContext,
} from "./helpers.js";

interface TwowaySession {
  id: string;
  ownerToken: string;
  qrToken: string;
  visualId: string;
  mode: "twoway";
  hostId: string;
}

interface Joined {
  id: string;
  name: string;
  device: "phone" | "desktop";
  credential: string;
}

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

function streams(ws: WebSocket) {
  const messages: Message[] = [];
  let cursor = 0;
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as Message);
  });

  return {
    messages,
    async waitFor(
      predicate: (message: Message) => boolean,
      timeout = 5000,
    ): Promise<Message> {
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
    countMatching(predicate: (message: Message) => boolean): number {
      return messages.filter(predicate).length;
    },
  };
}

async function connect(
  baseUrl: string,
  sessionId: string,
  role: string,
  secret: string,
): Promise<{ ws: WebSocket; stream: ReturnType<typeof streams>; auth: Message }> {
  const ws = new WebSocket(`${baseUrl}/api/sessions/${sessionId}/ws`);
  await waitOpen(ws);
  const stream = streams(ws);
  ws.send(JSON.stringify({ type: "auth", role, secret }));
  const auth = await stream.waitFor((message) => message.type === "auth_ok");
  return { ws, stream, auth };
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.close();
  await Promise.race([closed, delay(1000)]);
}

async function createTwoway(
  ctx: TestContext,
  body: Record<string, unknown> = { mode: "twoway", name: "Host" },
): Promise<TwowaySession> {
  const res = await ctx.app.inject({ method: "POST", url: "/api/sessions", payload: body });
  expect(res.statusCode).toBe(201);
  return res.json() as TwowaySession;
}

async function joinParticipant(
  ctx: TestContext,
  session: TwowaySession,
  name: string,
  device: "phone" | "desktop" = "phone",
  qrToken = session.qrToken,
): Promise<Joined> {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/participants`,
    payload: { qrToken, name, device },
  });
  expect(res.statusCode).toBe(201);
  const json = res.json() as { participant: Omit<Joined, "credential">; credential: string };
  return { ...json.participant, credential: json.credential };
}

async function upload(
  ctx: TestContext,
  session: TwowaySession,
  credential: string,
  content: Buffer | string,
  filename: string,
  kind?: "text",
) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const { body, contentType } = createMultipartPayload([
    {
      name: "file",
      content: bytes,
      filename,
      contentType: kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream",
    },
  ]);
  return ctx.app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/files${kind === "text" ? "?kind=text" : ""}`,
    headers: { authorization: `Bearer ${credential}`, "content-type": contentType },
    body,
  });
}

describe("twoway", () => {
  let ctx: TestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const address = ctx.app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("vários participantes entram com o mesmo QR, nomes repetidos são diferenciados e recebem a lista", async () => {
    const session = await createTwoway(ctx);
    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);

    const ana = await joinParticipant(ctx, session, "  Ana  ");
    const ana2 = await joinParticipant(ctx, session, "Ana", "desktop");
    expect(ana.name).toBe("Ana");
    expect(ana2.name).toBe("Ana (2)");
    expect(ana.device).toBe("phone");
    expect(ana2.device).toBe("desktop");

    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);
    const list = await anaWs.stream.waitFor((message) => message.type === "participants:list");
    const names = (list.participants as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(["Host", "Ana", "Ana (2)"]);

    const joined = await hostWs.stream.waitFor(
      (message) => message.type === "participant:joined" && message.id === ana.id,
    );
    expect(joined).toMatchObject({ id: ana.id, name: "Ana", device: "phone" });

    const ana2Ws = await connect(baseUrl, session.id, "guest", ana2.credential);
    const list2 = await ana2Ws.stream.waitFor((message) => message.type === "participants:list");
    expect(list2.participants).toHaveLength(3);

    await Promise.all([
      closeSocket(anaWs.ws),
      closeSocket(ana2Ws.ws),
      closeSocket(hostWs.ws),
    ]);
  });

  it("entrada comum por ID visual e código reconhece twoway sem consumir o código", async () => {
    const session = await createTwoway(ctx);
    const store = getAppContext(ctx.app).sessionStore;
    store.loginCodes.issue(session.id);
    const code = store.loginCodes.current(session.id)!.code;

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId: session.visualId, code },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      success: true,
      mode: "twoway",
      sessionId: session.id,
      visualId: session.visualId,
    });
    expect(first.json().phoneCredential).toBeUndefined();

    for (const name of ["Ana", "Bruno"]) {
      const joined = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/participants`,
        payload: { code, name, device: "phone" },
      });
      expect(joined.statusCode).toBe(201);
    }
  });

  it("quem entra depois vê o histórico anterior", async () => {
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const uploaded = await upload(ctx, session, ana.credential, "histórico", "antes.txt");
    expect(uploaded.statusCode).toBe(201);
    const file = uploaded.json().files[0];

    const bruno = await joinParticipant(ctx, session, "Bruno");
    const list = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${bruno.credential}` },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().files).toHaveLength(1);
    expect(list.json().files[0]).toMatchObject({
      id: file.id,
      originalName: "antes.txt",
      senderId: ana.id,
      senderName: "Ana",
      origin: "phone",
    });

    const downloaded = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${bruno.credential}` },
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload.toString()).toBe("histórico");
  });

  it("autor apaga o próprio item, anfitrião apaga qualquer um e outro participante é recusado", async () => {
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const bruno = await joinParticipant(ctx, session, "Bruno");
    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);

    const fileA = (await upload(ctx, session, ana.credential, "A", "a.txt")).json().files[0];
    const fileB = (await upload(ctx, session, ana.credential, "B", "b.txt")).json().files[0];

    const denied = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/files/${fileA.id}`,
      headers: { authorization: `Bearer ${bruno.credential}` },
    });
    expect(denied.statusCode).toBe(403);

    const own = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/files/${fileA.id}`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(own.statusCode).toBe(204);
    expect(existsSync(join(ctx.config.tempDir, session.id, fileA.id))).toBe(false);

    const hostDeleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/files/${fileB.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(hostDeleted.statusCode).toBe(204);
    expect(existsSync(join(ctx.config.tempDir, session.id, fileB.id))).toBe(false);

    const first = await hostWs.stream.waitFor(
      (message) => message.type === "item:deleted" && message.id === fileA.id,
    );
    expect(first).toEqual({ type: "item:deleted", id: fileA.id });
    await hostWs.stream.waitFor(
      (message) => message.type === "item:deleted" && message.id === fileB.id,
    );

    await closeSocket(hostWs.ws);
  });

  it("todos recebem item:added e o autor recebe o próprio item uma única vez", async () => {
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);

    const uploaded = await upload(ctx, session, ana.credential, "evento", "evento.txt");
    expect(uploaded.statusCode).toBe(201);
    const file = uploaded.json().files[0];

    const expected = {
      type: "item:added",
      id: file.id,
      kind: "file",
      name: "evento.txt",
      size: Buffer.byteLength("evento"),
      senderId: ana.id,
      senderName: "Ana",
      origin: "phone",
    };
    const atSender = await anaWs.stream.waitFor((message) => message.type === "item:added");
    const atHost = await hostWs.stream.waitFor((message) => message.type === "item:added");
    expect(atSender).toMatchObject(expected);
    expect(atHost).toMatchObject(expected);
    expect(typeof atSender.createdAt).toBe("string");

    await delay(250);
    expect(anaWs.stream.countMatching((message) => message.type === "item:added")).toBe(1);

    await Promise.all([closeSocket(hostWs.ws), closeSocket(anaWs.ws)]);
  });

  it("item de texto também emite item:added com kind text", async () => {
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);

    const uploaded = await upload(ctx, session, ana.credential, "texto", "nota.txt", "text");
    expect(uploaded.statusCode).toBe(201);

    const event = await anaWs.stream.waitFor((message) => message.type === "item:added");
    expect(event).toMatchObject({
      kind: "text",
      name: "nota.txt",
      senderId: ana.id,
      senderName: "Ana",
      origin: "phone",
    });

    await closeSocket(anaWs.ws);
  });

  it("só o anfitrião encerra; convidado recebe recusa e todos recebem session:closed com arquivos apagados", async () => {
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const uploaded = await upload(ctx, session, ana.credential, "apagar", "apagar.txt");
    expect(uploaded.statusCode).toBe(201);

    const hostWs = await connect(baseUrl, session.id, "computer", session.ownerToken);
    const anaWs = await connect(baseUrl, session.id, "guest", ana.credential);

    const denied = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(denied.statusCode).toBe(403);

    const stillOpen = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(stillOpen.statusCode).toBe(200);

    const hostClosed = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(hostClosed.statusCode).toBe(204);

    const closedEvent = await anaWs.stream.waitFor((message) => message.type === "session:closed");
    expect(closedEvent).toMatchObject({ type: "session:closed", reason: "host_closed" });
    await hostWs.stream.waitFor((message) => message.type === "session:closed");

    const stored = getAppContext(ctx.app).sessionStore.getById(session.id)!;
    expect(stored.state).toBe("CLOSED");
    expect(stored.files).toHaveLength(0);
    expect(stored.participants).toHaveLength(0);
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(false);

    const joinAfterClose = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Tarde", device: "phone" },
    });
    expect(joinAfterClose.statusCode).toBe(410);

    await Promise.all([closeSocket(hostWs.ws), closeSocket(anaWs.ws)]);
  });

  it("sanitiza nome, recusa nome vazio e guarda o device", async () => {
    const session = await createTwoway(ctx);

    const htmlName = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "<b> Ana </b>", device: "desktop" },
    });
    expect(htmlName.statusCode).toBe(201);
    expect(htmlName.json().participant).toMatchObject({
      name: "Ana",
      device: "desktop",
    });

    const empty = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "<i> </i>", device: "phone" },
    });
    expect(empty.statusCode).toBe(400);
  });
});

describe("limites twoway", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  it("respeita o limite de participantes por sessão", async () => {
    ctx = await createTestApp({ twowayMaxParticipants: 2 });
    const session = await createTwoway(ctx);

    await joinParticipant(ctx, session, "Ana");

    const full = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Bruno", device: "phone" },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().code).toBe("SESSION_FULL");
  });

  it("recusa arquivo que passa do limite total de armazenamento", async () => {
    ctx = await createTestApp({ twowayMaxTotalBytes: 10 });
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");

    const res = await upload(ctx, session, ana.credential, Buffer.alloc(20, 0x41), "grande.bin");
    expect(res.statusCode).toBe(413);

    const list = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${ana.credential}` },
    });
    expect(list.json().files).toHaveLength(0);
  });

  it("código em twoway é reutilizável e tentativas erradas por IP terminam em 429", async () => {
    ctx = await createTestApp();
    const session = await createTwoway(ctx);

    const issued = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/login-code`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(issued.statusCode).toBe(202);
    const code = getAppContext(ctx.app).sessionStore.loginCodes.current(session.id)!.code;

    for (const name of ["Ana", "Bruno"]) {
      const joined = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/participants`,
        payload: { code, name, device: "phone" },
      });
      expect(joined.statusCode).toBe(201);
    }

    const wrong = code === "000000" ? "000001" : "000000";
    let blocked: { statusCode: number; headers: Record<string, unknown> } | null = null;
    for (let i = 0; i < 12; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/participants`,
        payload: { code: wrong, name: `Tentativa ${i}`, device: "phone" },
      });
      if (res.statusCode === 429) {
        blocked = res;
        break;
      }
      expect(res.statusCode).toBe(401);
    }

    expect(blocked).not.toBeNull();
    expect(String(blocked!.headers["retry-after"])).toMatch(/^\d+$/);

    const alive = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(alive.statusCode).toBe(200);
  });
});

describe("expiração por inatividade twoway", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  it("apaga arquivos, participantes e código quando a sessão fica inativa", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp(
      { twowayIdleTimeoutMs: 1000 },
      { clock, startSweeper: false },
    );
    const session = await createTwoway(ctx);
    const ana = await joinParticipant(ctx, session, "Ana");
    const uploaded = await upload(ctx, session, ana.credential, "sumir", "sumir.txt");
    expect(uploaded.statusCode).toBe(201);
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(true);

    const store = getAppContext(ctx.app).sessionStore;
    store.loginCodes.issue(session.id);
    expect(store.loginCodes.current(session.id)).not.toBeNull();

    clock.advance(2000);
    await store.tick();

    const stored = store.getById(session.id)!;
    expect(stored.state).toBe("CLOSED");
    expect(stored.files).toHaveLength(0);
    expect(stored.participants).toHaveLength(0);
    expect(existsSync(join(ctx.config.tempDir, session.id))).toBe(false);
    expect(store.loginCodes.current(session.id)).toBeNull();
  });
});

describe("publication of concurrent edits", () => {
  it("does not recreate an item deleted during PUT or block DELETE behind the upload", async () => {
    const ctx = await createTestApp();
    const stream = new PassThrough();
    try {
      const session = await createTwoway(ctx);
      const guest = await joinParticipant(ctx, session, "Guest");
      const uploaded = await upload(ctx, session, guest.credential, "original", "file.txt");
      expect(uploaded.statusCode).toBe(201);
      const { id } = uploaded.json().files[0];
      const directory = join(ctx.tempDir, session.id);
      const { fileService, sessionStore } = getAppContext(ctx.app);
      const record = sessionStore.getById(session.id)!.files[0]!;
      const edit = fileService.replaceFile(session.id, id, "file.txt", "text/plain", stream)
        .catch((err: unknown) => err);

      try {
        stream.write("new");
        await expect.poll(async () => (await readdir(directory)).length).toBe(2);
        expect(await readFile(join(directory, id), "utf8")).toBe("original");
        const response = await ctx.app.inject({
          method: "DELETE",
          url: `/api/sessions/${session.id}/files/${id}`,
          headers: { authorization: `Bearer ${session.ownerToken}` },
        });
        expect(response.statusCode).toBe(204);
      } finally {
        stream.end();
      }

      const result = await edit;
      expect({ status: (result as { statusCode?: number }).statusCode, version: record.version,
        entries: await readdir(directory), remaining: sessionStore.getById(session.id)!.files.length,
      }).toEqual({ status: 404, version: 1, entries: [], remaining: 0 });
    } finally {
      stream.destroy();
      await cleanupTestApp(ctx);
    }
  });
});

it("keeps a lone host upload alive and expires guest presence independently", async () => {
  const clock = new FakeClock(1000);
  const ctx = await createTestApp({ heartbeatTimeoutMs: 5000 }, { clock });
  try {
    const session = await createTwoway(ctx);
    const store = getAppContext(ctx.app).sessionStore;
    const live = store.getById(session.id)!;
    const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const endpoint = `${address}/api/sessions/${session.id}`;
    const wsUrl = address.replace("http:", "ws:");
    const host = await connect(wsUrl, session.id, "computer", session.ownerToken);
    const req = request(endpoint + "/files", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.ownerToken}`,
        "content-type": "multipart/form-data; boundary=host-upload",
      },
    });
    const response = new Promise<number | undefined>((resolve, reject) => {
      req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
    });
    void response.catch(() => {});
    try {
      req.write('--host-upload\r\nContent-Disposition: form-data; name="file"; filename="file.txt"\r\n\r\nhello');
      await expect.poll(() => live.files[0]?.bytesReceived).toBe(5);
      await store.tick();
      expect(live.state).toBe("TRANSFERRING");

      const guest = await joinParticipant(ctx, session, "Guest");
      const guestWs = await connect(wsUrl, session.id, "phone", guest.credential);
      try {
        clock.advance(5001);
        host.ws.send(JSON.stringify({ type: "heartbeat" }));
        await host.stream.waitFor((message) => message.type === "heartbeat_ack");
        await store.tick();
        await host.stream.waitFor((message) => message.type === "participant:left" && message.id === guest.id);
        expect(live.state).toBe("TRANSFERRING");
        req.end("\r\n--host-upload--\r\n");
        expect(await response).toBe(201);
        expect(await readFile(join(ctx.tempDir, session.id, live.files[0]!.id), "utf8")).toBe("hello");
        const reconnected = await connect(wsUrl, session.id, "phone", guest.credential);
        try {
          expect(reconnected.auth).toMatchObject({
            session: { id: session.id, computerPresent: true },
            files: [{ id: live.files[0]!.id, version: 1, size: 5 }],
          });
        } finally {
          await closeSocket(reconnected.ws);
        }
      } finally {
        await closeSocket(guestWs.ws);
      }
    } finally {
      req.destroy();
      await closeSocket(host.ws);
    }
  } finally {
    await cleanupTestApp(ctx);
  }
});

it("keeps a closed room briefly for 410 while freeing its visual ID for reuse", async () => {
  const clock = new FakeClock(1000);
  const ctx = await createTestApp(undefined, { clock });
  try {
    const original = await createTwoway(ctx);
    const store = getAppContext(ctx.app).sessionStore;
    const active = store.getById(original.id)!;
    await store.closeSession(original.id);
    const endpoint = `/api/sessions/${original.id}/participants`;
    const joinRoom = () => ctx.app.inject({
      method: "POST", url: endpoint,
      payload: { qrToken: original.qrToken, name: "Guest", device: "phone" },
    });
    expect((await joinRoom()).statusCode).toBe(410);
    const replacement = { ...active, id: "replacement", state: "PAIRED" as const };
    store.create(replacement);
    expect(store.getAll().map((session) => session.id)).toEqual(["replacement"]);
    expect(store.getByNormalizedVisualId(original.visualId)).toBe(replacement);
    clock.advance(60_001);
    await store.tick();
    expect((await joinRoom()).statusCode).toBe(404);
    expect(store.getByNormalizedVisualId(original.visualId)).toBe(replacement);
  } finally {
    await cleanupTestApp(ctx);
  }
});

it("coalesces simultaneous sweeps while cleanup is pending", async () => {
  const ctx = await createTestApp();
  try {
    const store = getAppContext(ctx.app).sessionStore;
    const first = store.tick();
    expect(store.tick()).toBe(first);
    await first;
    expect(store.tick()).not.toBe(first);
  } finally {
    await cleanupTestApp(ctx);
  }
});
