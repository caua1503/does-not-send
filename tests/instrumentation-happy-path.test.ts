/**
 * Etapa 2: Testes do fluxo feliz de instrumentação.
 *
 * Que bug real este teste pega?
 * - Evento omitido em alguma etapa do fluxo (criação, pareamento, uploads, fechamento).
 * - Campos críticos errados: extension/category derivados do nome errado, size sendo o
 *   declarado pelo cliente em vez do escrito no disco, closedAt/reason ausentes ou trocados.
 * - Ordem dos eventos trocada (ex: session_closed antes de transfer_finished).
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildApp, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { InMemoryRecorder } from "../src/recording/index.js";
import type { FastifyInstance } from "fastify";
import type {
  SessionCreated,
  SessionPaired,
  SessionClosed,
  TransferStarted,
  TransferFinished,
} from "../src/recording/events.js";import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultipartPayload } from "./helpers.js";

function buildPayload(
  content: Buffer,
  filename: string,
  contentType = "application/octet-stream",
) {
  return createMultipartPayload([{ name: "file", content, filename, contentType }]);
}

describe("Instrumentação: fluxo feliz", () => {
  let app: FastifyInstance;
  let recorder: InMemoryRecorder;
  let tempDir: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function setup() {
    tempDir = await mkdtemp(join(tmpdir(), "dns-instr-"));
    recorder = new InMemoryRecorder();
    const config = {
      ...loadConfig(),
      tempDir,
      maxFileSize: 10 * 1024 * 1024,
      maxFilesPerSession: 10,
    };
    app = await buildApp(config, { startSweeper: false, recorder });
    return (app as unknown as { ctx: AppContext }).ctx;
  }

  it("emite sequência correta de eventos: criar → parear → 2 uploads → fechar", async () => {
    await setup();

    // 1. Criar sessão
    const createRes = await app.inject({ method: "POST", url: "/api/sessions" });
    expect(createRes.statusCode).toBe(201);
    const { id, computerToken, qrToken } = createRes.json() as {
      id: string;
      computerToken: string;
      qrToken: string;
    };

    // 2. Parear
    const pairRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(pairRes.statusCode).toBe(200);
    const { phoneCredential } = pairRes.json() as { phoneCredential: string };

    // 3. Upload 1: imagem
    const img = Buffer.from("PNG_FAKE_DATA");
    const { body: b1, contentType: ct1 } = buildPayload(img, "foto.png", "image/png");
    const up1 = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: { authorization: `Bearer ${phoneCredential}`, "content-type": ct1 },
      body: b1,
    });
    expect(up1.statusCode).toBe(201);

    // 4. Upload 2: documento
    const doc = Buffer.from("WORD_FAKE");
    const { body: b2, contentType: ct2 } = buildPayload(doc, "relatorio.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const up2 = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: { authorization: `Bearer ${phoneCredential}`, "content-type": ct2 },
      body: b2,
    });
    expect(up2.statusCode).toBe(201);

    // 5. Fechar sessão
    const closeRes = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${computerToken}` },
    });
    expect(closeRes.statusCode).toBe(204);

    const events = recorder.getEvents();

    // Sequência exata de tipos
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session_created",
      "session_paired",
      "transfer_started",
      "transfer_finished",
      "transfer_started",
      "transfer_finished",
      "session_closed",
    ]);

    // session_created
    const created = events[0] as SessionCreated;
    expect(created.sessionId).toBe(id);
    expect(typeof created.visualId).toBe("string");
    expect(created.visualId.length).toBeGreaterThan(0);
    expect(created.at).toBeInstanceOf(Date);

    // session_paired
    const paired = events[1] as SessionPaired;
    expect(paired.sessionId).toBe(id);
    expect(paired.at).toBeInstanceOf(Date);

    // transfer_started (imagem)
    const ts1 = events[2] as TransferStarted;
    expect(ts1.extension).toBe("png");
    expect(ts1.category).toBe("images");
    expect(ts1.at).toBeInstanceOf(Date);

    // transfer_finished (imagem) — size = bytes realmente escritos no disco
    const tf1 = events[3] as TransferFinished;
    expect(tf1.id).toBe(ts1.id);
    expect(tf1.status).toBe("completed");
    expect(tf1.size).toBe(img.length); // tamanho real, não o declarado
    expect(tf1.at).toBeInstanceOf(Date);

    // transfer_started (doc)
    const ts2 = events[4] as TransferStarted;
    expect(ts2.extension).toBe("docx");
    expect(ts2.category).toBe("documents");

    // transfer_finished (doc)
    const tf2 = events[5] as TransferFinished;
    expect(tf2.id).toBe(ts2.id);
    expect(tf2.status).toBe("completed");
    expect(tf2.size).toBe(doc.length);

    // session_closed
    const closed = events[6] as SessionClosed;
    expect(closed.sessionId).toBe(id);
    expect(closed.reason).toBe("user_closed");
    expect(closed.at).toBeInstanceOf(Date);
  });

  it("transfer_finished.size é o tamanho real, mesmo quando declarado é diferente", async () => {
    await setup();

    const createRes = await app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken } = createRes.json() as { id: string; qrToken: string };
    const pairRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    const { phoneCredential } = pairRes.json() as { phoneCredential: string };

    // Declara tamanho errado (1000) mas manda 7 bytes reais
    const content = Buffer.from("ABCDEFG"); // 7 bytes
    const { body, contentType: ct } = createMultipartPayload([
      { name: "file", content, filename: "test.txt", contentType: "text/plain" },
    ]);
    const upRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: {
        authorization: `Bearer ${phoneCredential}`,
        "content-type": ct,
        "content-length": "1000", // declarado errado
      },
      body,
    });
    expect(upRes.statusCode).toBe(201);

    const events = recorder.getEvents();
    const tf = events.find((e) => e.type === "transfer_finished") as TransferFinished | undefined;
    expect(tf).toBeDefined();
    expect(tf!.size).toBe(7); // bytes reais, não 1000
    expect(tf!.status).toBe("completed");
  });
});
