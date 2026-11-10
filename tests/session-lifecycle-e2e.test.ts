import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";
import { FakeClock } from "../src/session/clock.js";

describe("Ciclo de vida completo da sessão e reconexão (E2E)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  it("1. Primeira tentativa de pareamento funciona com sucesso", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });

    // Cria sessão no computador
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
    });
    expect(createRes.statusCode).toBe(201);
    const session = createRes.json();
    expect(session.id).toBeDefined();
    expect(session.qrToken).toBeDefined();

    // Primeira tentativa de pareamento pelo telefone
    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pairRes.statusCode).toBe(200);
    const pairBody = pairRes.json();
    expect(pairBody.success).toBe(true);
    expect(pairBody.phoneCredential).toBeDefined();
    expect(pairBody.state).toBe("PAIRED");

    const store = (ctx.app as any).ctx.sessionStore;
    // Verifica que lastSeen.phone foi registrado
    expect(store.isPhonePresent(session.id)).toBe(true);
  });

  it("2. Repetir a leitura do mesmo QR emite nova credencial e substitui a anterior", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });

    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const session = createRes.json();

    const pair1 = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pair1.statusCode).toBe(200);

    const pair2 = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pair2.statusCode).toBe(200);
    expect(pair2.json().phoneCredential).not.toBe(pair1.json().phoneCredential);

    // O celular antigo deixa de autenticar; o novo assume o upload
    const oldUpload = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${pair1.json().phoneCredential}` },
    });
    expect(oldUpload.statusCode).toBe(401);
    const newUpload = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${pair2.json().phoneCredential}` },
    });
    expect(newUpload.statusCode).not.toBe(401);
  });

  it("3. Autenticação do telefone e do computador no WebSocket atualiza presença imediatamente", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });

    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const session = createRes.json();

    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    const { phoneCredential } = pairRes.json();
    const store = (ctx.app as any).ctx.sessionStore;

    // Simula sockets para computador e telefone
    const compSocket = { readyState: 1, send: () => {}, close: () => {} };
    const phoneSocket = { readyState: 1, send: () => {}, close: () => {} };

    // Autentica computador
    const compAuth = store.authenticateWs(session.id, "computer", session.computerToken, compSocket);
    expect(compAuth.ok).toBe(true);
    expect(store.isComputerPresent(session.id)).toBe(true);

    // Autentica telefone
    const phoneAuth = store.authenticateWs(session.id, "phone", phoneCredential, phoneSocket);
    expect(phoneAuth.ok).toBe(true);
    expect(store.isPhonePresent(session.id)).toBe(true);
  });

  it("4. Desconexão temporária e reconexão com phoneCredential restaura presença e estado PAIRED", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });

    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const session = createRes.json();

    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    const { phoneCredential } = pairRes.json();
    const store = (ctx.app as any).ctx.sessionStore;

    // Telefone conecta
    const phoneSocket1 = { readyState: 1, send: () => {}, close: () => {} };
    store.authenticateWs(session.id, "phone", phoneCredential, phoneSocket1);

    // Avança além do timeout de presença (26s) sem heartbeat
    clock.advance(26000);
    expect(store.isPhonePresent(session.id)).toBe(false);

    // Tick move para DISCONNECTED
    await store.tick();
    expect(store.getById(session.id)!.state).toBe("DISCONNECTED");

    // Telefone reconecta utilizando phoneCredential dentro da tolerância
    clock.advance(2000); // 2s depois
    const phoneSocket2 = { readyState: 1, send: () => {}, close: () => {} };
    const reauth = store.authenticateWs(session.id, "phone", phoneCredential, phoneSocket2);
    expect(reauth.ok).toBe(true);

    // Presença e estado PAIRED restaurados
    expect(store.isPhonePresent(session.id)).toBe(true);
    expect(store.getById(session.id)!.state).toBe("PAIRED");
  });

  it("5. Encerramento definitivo da sessão recusa pareamento e uploads (410)", async () => {
    const clock = new FakeClock(1000);
    ctx = await createTestApp({}, { clock, startSweeper: false });

    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const session = createRes.json();
    const store = (ctx.app as any).ctx.sessionStore;

    // Computador encerra a sessão
    await store.closeSession(session.id, "user_closed");

    // Tentativa de pareamento em sessão encerrada
    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pairRes.statusCode).toBe(410);
    expect(pairRes.json().code).toBe("CLOSED");
  });
});
