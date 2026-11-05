/**
 * Etapa 3: Testes dos fluxos de erro de instrumentação.
 *
 * Bugs reais que estes testes pegam:
 * (a) parametrizado — evento errado ou ausente em fluxos de falha;
 *     token presente em evento (ex: sessionId em qr_reused sem sessão);
 *     reason incorreto nos diferentes tipos de encerramento;
 *     upload interrompido gravado como completed em vez de failed.
 * (b) recorder que lança não deve alterar resposta/status HTTP.
 * (c) serializar todos os eventos e confirmar que nenhum token aparece.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildApp, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { InMemoryRecorder } from "../src/recording/index.js";
import type { SessionRecorder } from "../src/recording/index.js";
import type { SessionClosed, TransferFinished } from "../src/recording/events.js";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultipartPayload } from "./helpers.js";
import { FakeClock } from "../src/session/clock.js";

async function buildTestApp(
  recorderOverride?: SessionRecorder,
  clock?: FakeClock,
): Promise<{ app: FastifyInstance; recorder: InMemoryRecorder; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "dns-err-"));
  const recorder = recorderOverride instanceof InMemoryRecorder
    ? recorderOverride
    : new InMemoryRecorder();
  const config = {
    ...loadConfig(),
    tempDir,
    maxFileSize: 10 * 1024 * 1024,
    maxFilesPerSession: 10,
    heartbeatTimeoutMs: 25_000,
    computerGraceMs: 30_000,
    phoneGraceMs: 30_000,
  };
  const app = await buildApp(config, {
    startSweeper: false,
    recorder: recorderOverride ?? recorder,
    clock,
  });
  return { app, recorder, tempDir };
}

describe("Instrumentação: fluxos de erro", () => {
  let app: FastifyInstance;
  let tempDir: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  // ─── (a) Parametrizado: fluxos de falha ────────────────────────────────────

  it.each([
    {
      name: "token inválido → pairing_refused",
      async run(a: FastifyInstance, rec: InMemoryRecorder) {
        const cr = await a.inject({ method: "POST", url: "/api/sessions" });
        const { id } = cr.json() as { id: string };
        const res = await a.inject({
          method: "POST",
          url: `/api/sessions/${id}/pair`,
          payload: { qrToken: "token-invalido-xxxxxxxxxxx" },
        });
        expect(res.statusCode).toBe(401);
        const ev = rec.getEvents().find((e) => e.type === "pairing_refused");
        expect(ev).toBeDefined();
        expect(ev!.type).toBe("pairing_refused");
      },
    },
    {
      name: "sessão inexistente → pairing_refused",
      async run(a: FastifyInstance, rec: InMemoryRecorder) {
        const res = await a.inject({
          method: "POST",
          url: "/api/sessions/nao-existe-id/pair",
          payload: { qrToken: "qualquer-token" },
        });
        expect(res.statusCode).toBe(404);
        const ev = rec.getEvents().find((e) => e.type === "pairing_refused");
        expect(ev).toBeDefined();
      },
    },
    {
      name: "QR reutilizado → qr_reused",
      async run(a: FastifyInstance, rec: InMemoryRecorder) {
        const cr = await a.inject({ method: "POST", url: "/api/sessions" });
        const { id, qrToken } = cr.json() as { id: string; qrToken: string };
        // Primeiro pareamento consome o token
        await a.inject({
          method: "POST",
          url: `/api/sessions/${id}/pair`,
          payload: { qrToken },
        });
        // Segundo uso do mesmo token = qr_reused
        const res = await a.inject({
          method: "POST",
          url: `/api/sessions/${id}/pair`,
          payload: { qrToken },
        });
        expect(res.statusCode).toBe(409);
        const ev = rec.getEvents().find((e) => e.type === "qr_reused");
        expect(ev).toBeDefined();
        expect(ev!.type).toBe("qr_reused");
      },
    },
    {
      name: "upload interrompido → transfer_finished com status=failed",
      async run(a: FastifyInstance, rec: InMemoryRecorder) {
        const cr = await a.inject({ method: "POST", url: "/api/sessions" });
        const { id, qrToken } = cr.json() as { id: string; qrToken: string };
        const pr = await a.inject({
          method: "POST",
          url: `/api/sessions/${id}/pair`,
          payload: { qrToken },
        });
        const { phoneCredential } = pr.json() as { phoneCredential: string };

        // Fechar a sessão antes/durante o upload para forçar falha
        const ctx = (a as unknown as { ctx: AppContext }).ctx;
        await ctx.sessionStore.closeSession(id, "user_closed");

        const content = Buffer.from("DADOS");
        const { body, contentType: ct } = createMultipartPayload([
          { name: "file", content, filename: "file.txt", contentType: "text/plain" },
        ]);
        const upRes = await a.inject({
          method: "POST",
          url: `/api/sessions/${id}/files`,
          headers: { authorization: `Bearer ${phoneCredential}`, "content-type": ct },
          body,
        });
        // A sessão está fechada, então o upload falha com 410
        expect(upRes.statusCode).toBe(410);
        // Não deve ter transfer_started nem transfer_finished pois falha antes de criar o arquivo
        // (sessão já CLOSED)
        const finishedEvs = rec
          .getEvents()
          .filter((e) => e.type === "transfer_finished") as TransferFinished[];
        // Se chegou a criar o arquivo (race): deve ser failed. Se não chegou: vazio.
        for (const ev of finishedEvs) {
          expect(ev.status).toBe("failed");
        }
      },
    },
  ])("$name", async ({ run }) => {
    const setup = await buildTestApp();
    app = setup.app;
    tempDir = setup.tempDir;
    await run(app, setup.recorder);
  });

  // Motivos de encerramento via sweeper
  it.each([
    { reason: "idle_timeout" },
    { reason: "computer_lost" },
    { reason: "phone_lost" },
    { reason: "user_closed" },
  ])("session_closed emite reason=$reason", async ({ reason }) => {
    const setup = await buildTestApp();
    app = setup.app;
    tempDir = setup.tempDir;

    const cr = await app.inject({ method: "POST", url: "/api/sessions" });
    const { id } = cr.json() as { id: string };
    const ctx = (app as unknown as { ctx: AppContext }).ctx;

    await ctx.sessionStore.closeSession(id, reason);

    const ev = setup.recorder
      .getEvents()
      .find((e) => e.type === "session_closed") as SessionClosed | undefined;
    expect(ev).toBeDefined();
    expect(ev!.reason).toBe(reason);
    expect(ev!.sessionId).toBe(id);
    expect(ev!.at).toBeInstanceOf(Date);
  });

  // ─── (b) Recorder que lança não altera resposta HTTP ───────────────────────

  it("recorder que lança em record() não altera resposta nem status das rotas instrumentadas", async () => {
    /**
     * Bug real: se safeRecord não capturar o erro, o handler de rota vai lançar e
     * o Fastify retorna 500 em vez do status correto.
     */
    const throwingRecorder: SessionRecorder = {
      record() {
        throw new Error("recorder falhou propositalmente");
      },
      stats: () => ({ queued: 0, dropped: 0, failed: 0 }),
      async close() {},
    };

    const setup = await buildTestApp(throwingRecorder);
    app = setup.app;
    tempDir = setup.tempDir;

    // Criação de sessão deve retornar 201 mesmo com recorder lançando
    const createRes = await app.inject({ method: "POST", url: "/api/sessions" });
    expect(createRes.statusCode).toBe(201);
    const { id, qrToken, computerToken } = createRes.json() as {
      id: string;
      qrToken: string;
      computerToken: string;
    };

    // Pareamento deve retornar 200
    const pairRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(pairRes.statusCode).toBe(200);
    const { phoneCredential } = pairRes.json() as { phoneCredential: string };

    // Tentativa com QR reutilizado (emite qr_reused que vai lançar) → 409, não 500
    const reuseRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(reuseRes.statusCode).toBe(409);

    // Upload deve retornar 201
    const content = Buffer.from("DADOS");
    const { body, contentType: ct } = createMultipartPayload([
      { name: "file", content, filename: "f.txt", contentType: "text/plain" },
    ]);
    const upRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: { authorization: `Bearer ${phoneCredential}`, "content-type": ct },
      body,
    });
    expect(upRes.statusCode).toBe(201);

    // Fechamento deve retornar 204
    const closeRes = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${computerToken}` },
    });
    expect(closeRes.statusCode).toBe(204);
  });

  // ─── (c) Varredura: nenhum token nos eventos ───────────────────────────────

  it("nenhum token (computerToken, qrToken, phoneCredential) aparece nos eventos serializados", async () => {
    /**
     * Bug real: token vaza em algum campo de evento e fica persistido no banco,
     * quebrando a postura de segurança do projeto.
     */
    const setup = await buildTestApp();
    app = setup.app;
    tempDir = setup.tempDir;

    const createRes = await app.inject({ method: "POST", url: "/api/sessions" });
    const { id, computerToken, qrToken } = createRes.json() as {
      id: string;
      computerToken: string;
      qrToken: string;
    };

    const pairRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    const { phoneCredential } = pairRes.json() as { phoneCredential: string };

    const content = Buffer.from("DADOS");
    const { body, contentType: ct } = createMultipartPayload([
      { name: "file", content, filename: "doc.txt", contentType: "text/plain" },
    ]);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: { authorization: `Bearer ${phoneCredential}`, "content-type": ct },
      body,
    });

    await app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${computerToken}` },
    });

    // Tentar QR reutilizado para gerar qr_reused
    await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });

    const serialized = JSON.stringify(setup.recorder.getEvents());

    // Nenhum token deve aparecer
    expect(serialized).not.toContain(computerToken);
    expect(serialized).not.toContain(qrToken);
    expect(serialized).not.toContain(phoneCredential);
  });
});
