import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { InMemoryRecorder } from "../src/recording/index.js";
import { createMultipartPayload, createSession, type SessionTokens } from "./helpers.js";

describe("upload com originalSize", () => {
  let app: FastifyInstance;
  let recorder: InMemoryRecorder;
  let tempDir: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function setup() {
    tempDir = await mkdtemp(join(tmpdir(), "dns-origsize-"));
    recorder = new InMemoryRecorder();
    app = await buildApp(
      { ...loadConfig(), tempDir, maxFileSize: 10 * 1024 * 1024, maxFilesPerSession: 10 },
      { startSweeper: false, recorder },
    );
    return createSession(app);
  }

  async function upload(session: SessionTokens, originalSize: string) {
    const { body, contentType } = createMultipartPayload(
      [{ name: "file", content: Buffer.from("conteudo"), filename: "foto.jpg", contentType: "image/jpeg" }],
      [{ name: "originalSize", value: originalSize }],
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
      body,
    });
    expect(res.statusCode).toBe(201);
  }

  function startedOriginalSize(): number | null | undefined {
    const event = recorder.getEvents().find((e) => e.type === "transfer_started");
    return event && event.type === "transfer_started" ? event.originalSize : undefined;
  }

  it("propaga o tamanho declarado pelo cliente", async () => {
    const session = await setup();
    await upload(session, "5242880");
    expect(startedOriginalSize()).toBe(5_242_880);
  });

  it("valor inválido vira null e não quebra o upload", async () => {
    // Que bug pega: cliente não confiável derrubando o envio por campo malformado.
    const session = await setup();
    await upload(session, "abc");
    expect(startedOriginalSize()).toBeNull();
  });
});
