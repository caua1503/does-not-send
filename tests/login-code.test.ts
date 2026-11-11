import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LoginCodeManager,
  generateLoginCode,
  normalizeSessionId,
  LOGIN_CODE_TTL_MS,
  type LoginCodeMessage,
} from "../src/session/login-code.js";
import { SESSION_FAILURE_LIMIT, IP_FAILURE_LIMIT } from "../src/session/login-guard.js";
import { FakeClock } from "../src/session/clock.js";
import { WebSocket } from "ws";
import type { SessionStore } from "../src/session/store.js";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";

describe("generateLoginCode", () => {
  it("gera sempre 6 dígitos", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLoginCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("normalizeSessionId", () => {
  it("remove espaços e hífens e converte para maiúsculas", () => {
    expect(normalizeSessionId(" a1b2-c3d4 ")).toBe("A1B2C3D4");
    expect(normalizeSessionId("A1B2 C3D4")).toBe("A1B2C3D4");
  });
});

describe("LoginCodeManager", () => {
  let clock: FakeClock;
  let sent: LoginCodeMessage[];
  let manager: LoginCodeManager;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    sent = [];
    manager = new LoginCodeManager({
      clock,
      notify: (message) => sent.push(message),
    });
  });

  it("valida o código correto e invalida após o uso", () => {
    manager.issue("EXISTS");
    const code = sent[0]!.code;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.code).toBe(code);

    expect(manager.consume("EXISTS", code)).toBe(true);
    expect(manager.consume("EXISTS", code)).toBe(false);
  });

  it("rejeita código expirado", () => {
    manager.issue("EXISTS");
    const code = sent[0]!.code;
    clock.advance(LOGIN_CODE_TTL_MS + 1);

    expect(manager.consume("EXISTS", code)).toBe(false);
  });

  it("rejeita código errado", () => {
    manager.issue("EXISTS");
    const issued = sent[0]!.code;
    const wrong = issued === "000000" ? "111111" : "000000";

    expect(manager.consume("EXISTS", wrong)).toBe(false);
  });

  it("rejeita sessão inexistente", () => {
    manager.issue("EXISTS");
    const code = sent[0]!.code;

    expect(manager.consume("MISSING", code)).toBe(false);
  });

  it("rotação invalida o código antigo e envia o novo ao computador", () => {
    manager.issue("EXISTS");
    const oldCode = sent[0]!.code;

    clock.advance(LOGIN_CODE_TTL_MS);
    manager.tick([{ id: "EXISTS" }]);

    expect(sent).toHaveLength(2);
    const newCode = sent[1]!.code;
    expect(newCode).not.toBe(oldCode);
    expect(manager.consume("EXISTS", oldCode)).toBe(false);
    expect(manager.consume("EXISTS", newCode)).toBe(true);
  });

  it("rotação após uso bem-sucedido gera novo código", () => {
    manager.issue("EXISTS");
    const code = sent[0]!.code;
    expect(manager.consume("EXISTS", code)).toBe(true);

    clock.advance(LOGIN_CODE_TTL_MS);
    manager.tick([{ id: "EXISTS" }]);

    expect(sent).toHaveLength(2);
    expect(manager.consume("EXISTS", sent[1]!.code)).toBe(true);
  });

  it("drop descarta o código da sessão", () => {
    manager.issue("EXISTS");
    const code = sent[0]!.code;
    manager.drop("EXISTS");

    expect(manager.consume("EXISTS", code)).toBe(false);
  });
});

describe("POST /api/sessions/join", () => {
  let ctx: TestContext;
  let clock: FakeClock;
  let baseUrl: string;
  const sockets: WebSocket[] = [];

  /** Every message the socket has already received, drained in order. */
  const inbox = new WeakMap<WebSocket, unknown[]>();
  const waiters = new WeakMap<WebSocket, () => void>();

  function nextMessage(
    ws: WebSocket,
    type: string = "login_code",
  ): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ws message timeout: ${type}`)), 5000);
      waiters.set(ws, () => {
        clearTimeout(timer);
        resolve(inbox.get(ws)!.shift() as Record<string, string>);
      });
      if (inbox.get(ws)!.length > 0) waiters.get(ws)!();
    });
  }

  async function openComputer(sessionId: string, computerToken: string): Promise<WebSocket> {
    const ws = new WebSocket(`${baseUrl}/api/sessions/${sessionId}/ws`);
    sockets.push(ws);
    inbox.set(ws, []);
    ws.addEventListener("message", (event) => {
      inbox.get(ws)!.push(JSON.parse(String(event.data)));
      waiters.get(ws)?.();
    });
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    ws.send(JSON.stringify({ type: "auth", role: "computer", secret: computerToken }));
    expect((await nextMessage(ws, "auth_ok")).type).toBe("auth_ok");
    return ws;
  }

  async function nextLoginCode(ws: WebSocket): Promise<string> {
    const message = await nextMessage(ws);
    expect(message.type).toBe("login_code");
    expect(message.code).toMatch(/^\d{6}$/);
    return message.code!;
  }

  function store() {
    return (ctx.app as unknown as { ctx: { sessionStore: SessionStore } }).ctx.sessionStore;
  }

  async function join(sessionId: string, code: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId, code },
    });
    return { statusCode: res.statusCode, body: res.body };
  }

  beforeEach(async () => {
    clock = new FakeClock(Date.now());
    // Real sweeper so codes issued in tick() actually reach the computer
    ctx = await createTestApp(undefined, { clock, startSweeper: true });
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const address = ctx.app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await cleanupTestApp(ctx);
  });

  it("código válido devolve token de celular utilizável", async () => {
    const session = await createSession(ctx.app, false);
    const code = await nextLoginCode(await openComputer(session.id, session.computerToken!));

    const res = await join(session.id, code);
    expect(res.statusCode).toBe(200);

    const { phoneCredential } = JSON.parse(res.body) as { phoneCredential: string };
    expect(typeof phoneCredential).toBe("string");

    const hb = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/heartbeat`,
      headers: { authorization: `Bearer ${phoneCredential}` },
    });
    expect(hb.statusCode).toBe(200);
  });

  it("normaliza o sessionId (maiúsculas, espaços e hífens)", async () => {
    const session = await createSession(ctx.app, false);
    const code = await nextLoginCode(await openComputer(session.id, session.computerToken!));

    const res = await join(` ${session.id.toUpperCase()} `, code);
    expect(res.statusCode).toBe(200);
  });

  it("falhas retornam a mesma resposta genérica", async () => {
    const session = await createSession(ctx.app, false);
    const code = await nextLoginCode(await openComputer(session.id, session.computerToken!));

    const wrong = await join(session.id, code === "000000" ? "111111" : "000000");
    const missing = await join("00000000-0000-4000-8000-000000000000", code);

    clock.advance(LOGIN_CODE_TTL_MS + 1);
    await store().tick();
    const expired = await join(session.id, code);

    const other = await createSession(ctx.app, false);
    const otherCode = await nextLoginCode(await openComputer(other.id, other.computerToken!));
    expect((await join(other.id, otherCode)).statusCode).toBe(200);
    const reused = await join(other.id, otherCode);

    expect(wrong.statusCode).toBe(401);
    for (const result of [wrong, missing, expired, reused]) {
      expect(result.statusCode).toBe(wrong.statusCode);
      expect(result.body).toBe(wrong.body);
    }
  });

  it("rotação: novo código chega ao computador e o antigo deixa de valer", async () => {
    const session = await createSession(ctx.app, false);
    const ws = await openComputer(session.id, session.computerToken!);
    const oldCode = await nextLoginCode(ws);

    clock.advance(LOGIN_CODE_TTL_MS + 1);
    await store().tick();

    const newCode = await nextLoginCode(ws);
    expect(newCode).not.toBe(oldCode);

    expect((await join(session.id, oldCode)).statusCode).toBe(401);
    expect((await join(session.id, newCode)).statusCode).toBe(200);
  });

  it("após entrada bem-sucedida há um novo código e o antigo não vale", async () => {
    const session = await createSession(ctx.app, false);
    const ws = await openComputer(session.id, session.computerToken!);
    const code = await nextLoginCode(ws);

    expect((await join(session.id, code)).statusCode).toBe(200);

    const nextCode = await nextLoginCode(ws);
    expect(nextCode).not.toBe(code);

    expect((await join(session.id, code)).statusCode).toBe(401);
    expect((await join(session.id, nextCode)).statusCode).toBe(200);
  });
});

describe("POST /api/sessions/join — proteção contra adivinhação", () => {
  let ctx: TestContext;
  let clock: FakeClock;
  let baseUrl: string;
  const sockets: WebSocket[] = [];

  const inbox = new WeakMap<WebSocket, unknown[]>();

  function nextLoginCode(ws: WebSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const list = inbox.get(ws)!;
        const index = list.findIndex(
          (m) => (m as { type?: string }).type === "login_code",
        );
        if (index !== -1) {
          const [message] = list.splice(index, 1) as Array<{ code: string }>;
          return resolve(message!.code);
        }
        if (Date.now() - started > 5000) return reject(new Error("login_code timeout"));
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  async function openComputer(sessionId: string, computerToken: string): Promise<WebSocket> {
    const ws = new WebSocket(`${baseUrl}/api/sessions/${sessionId}/ws`);
    sockets.push(ws);
    inbox.set(ws, []);
    ws.addEventListener("message", (event) => inbox.get(ws)!.push(JSON.parse(String(event.data))));
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    ws.send(JSON.stringify({ type: "auth", role: "computer", secret: computerToken }));
    return ws;
  }

  function store() {
    return (ctx.app as unknown as { ctx: { sessionStore: SessionStore } }).ctx.sessionStore;
  }

  async function join(sessionId: string, code: string, remoteAddress?: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId, code },
      ...(remoteAddress
        ? { remoteAddress, headers: { "x-forwarded-for": "203.0.113.9" } }
        : { remoteAddress }),
    });
    return { statusCode: res.statusCode, body: res.body, headers: res.headers };
  }

  beforeEach(async () => {
    clock = new FakeClock(Date.now());
    ctx = await createTestApp(undefined, { clock, startSweeper: true });
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const address = ctx.app.server.address() as { port: number };
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await cleanupTestApp(ctx);
  });

  it("5 códigos errados invalidam o código atual e enviam outro ao computador", async () => {
    const session = await createSession(ctx.app, false);
    const ws = await openComputer(session.id, session.computerToken!);
    const code = await nextLoginCode(ws);
    const wrong = code === "000000" ? "111111" : "000000";

    const results = [];
    for (let i = 0; i < SESSION_FAILURE_LIMIT; i++) {
      results.push(await join(session.id, wrong, `10.0.0.${i}`));
    }
    expect(results.every((r) => r.statusCode === 401)).toBe(true);

    const fresh = await nextLoginCode(ws);
    expect(fresh).not.toBe(code);
    expect((await join(session.id, code, "10.0.1.1")).statusCode).toBe(401);
    expect((await join(session.id, fresh, "10.0.1.2")).statusCode).toBe(200);
    expect((await store().loginGuard.ipFailures("10.0.0.0"))).toBe(1);
  });

  it("acerto zera o contador de falhas da sessão", async () => {
    const session = await createSession(ctx.app, false);
    const ws = await openComputer(session.id, session.computerToken!);
    const code = await nextLoginCode(ws);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) {
      await join(session.id, wrong, `10.0.2.${i}`);
    }
    expect((await join(session.id, code, "10.0.3.1")).statusCode).toBe(200);

    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) {
      expect((await join(session.id, wrong, `10.0.4.${i}`)).statusCode).toBe(401);
    }
  });

  it("10 falhas por IP retornam 429, com corpo que não revela o ID", async () => {
    const session = await createSession(ctx.app, false);
    const ws = await openComputer(session.id, session.computerToken!);
    await nextLoginCode(ws);
    const wrong = "000000";

    for (let i = 0; i < IP_FAILURE_LIMIT; i++) {
      expect((await join(session.id, wrong, "10.1.0.1")).statusCode).toBe(401);
    }

    const known = await join(session.id, wrong, "10.1.0.1");
    const unknown = await join("nope", wrong, "10.1.0.1");
    expect(known.statusCode).toBe(429);
    expect(unknown.statusCode).toBe(429);
    expect(unknown.body).toBe(known.body);
    expect(known.headers["retry-after"]).toBe("60");

    // Outro IP continua livre
    expect((await join(session.id, wrong, "10.1.0.2")).statusCode).toBe(401);
  });

  it("ignora X-Forwarded-For sem proxy confiável configurado", async () => {
    const session = await createSession(ctx.app, false);
    const original = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      for (let i = 0; i < IP_FAILURE_LIMIT; i++) {
        await join(session.id, "000000", "10.2.0.1");
      }
      // Mesmo IP de conexão com cabeçalho forjado: continua bloqueado
      expect((await join(session.id, "000000", "10.2.0.1")).statusCode).toBe(429);
    } finally {
      if (original !== undefined) process.env.TRUST_PROXY = original;
    }
  });
});
