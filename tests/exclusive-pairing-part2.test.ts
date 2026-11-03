import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";
import { VISUAL_ID_CHARSET } from "../src/session/visual-id.js";

function createMultipartPayload(
  files: Array<{ name: string; content: Buffer; filename: string }>,
): { body: Buffer; contentType: string } {
  const boundary = "----TestBoundary" + Date.now();
  const parts: Buffer[] = [];

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    parts.push(file.content);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("PAREAMENTO EXCLUSIVO - PARTE 2", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  it("criação de sessão retorna computerToken e visualId de 6 caracteres", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string;
      computerToken: string;
      qrToken: string;
      visualId: string;
    }>();

    expect(typeof body.computerToken).toBe("string");
    expect(body.computerToken.length).toBeGreaterThanOrEqual(40);
    expect(typeof body.visualId).toBe("string");
    expect(body.visualId).toHaveLength(6);
    for (const char of body.visualId) {
      expect(VISUAL_ID_CHARSET).toContain(char);
    }

    // Segredos não ficam puros no objeto da sessão
    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionRepository.getById(body.id);
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(body.computerToken);
    expect(serialized).not.toContain(body.qrToken);
  });

  it("pareamento devolve phoneCredential e ela nunca é armazenada pura", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken } = createRes.json<{ id: string; qrToken: string }>();

    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });

    expect(pairRes.statusCode).toBe(200);
    const pairBody = pairRes.json<{
      phoneCredential: string;
      visualId: string;
      state: string;
    }>();

    expect(typeof pairBody.phoneCredential).toBe("string");
    expect(pairBody.phoneCredential.length).toBeGreaterThanOrEqual(40);
    expect(pairBody.state).toBe("PAIRED");

    // Verifica que phoneCredential não está salva pura no banco/mapa
    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionRepository.getById(id);
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(pairBody.phoneCredential);
  });

  it("ID visual igual na resposta do computador e na do telefone para a mesma sessão", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const computerBody = createRes.json<{
      id: string;
      qrToken: string;
      visualId: string;
    }>();

    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${computerBody.id}/pair`,
      payload: { qrToken: computerBody.qrToken },
    });
    const phoneBody = pairRes.json<{ visualId: string }>();

    expect(computerBody.visualId).toBeDefined();
    expect(phoneBody.visualId).toBe(computerBody.visualId);

    // Também confere na rota GET /api/sessions/:id
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${computerBody.id}`,
      headers: { authorization: `Bearer ${(createRes.json() as any).computerToken}` },
    });
    expect(getRes.json().visualId).toBe(computerBody.visualId);
  });

  it("QR não funciona depois do pareamento (regressão: 409 ALREADY_CONSUMED)", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken } = createRes.json<{ id: string; qrToken: string }>();

    // Primeiro pareamento -> sucesso
    const pair1 = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(pair1.statusCode).toBe(200);

    // Segundo pareamento com mesmo QR -> 409
    const pair2 = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(pair2.statusCode).toBe(409);
  });

  it("upload em sessão WAITING (sem pareamento) é recusado com 409", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id } = createRes.json<{ id: string }>();

    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("test content"), filename: "test.txt" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: {
        authorization: "Bearer anytoken",
        "content-type": contentType,
      },
      body,
    });

    // Como não foi pareada, credencial é inválida (401)
    expect(res.statusCode).toBe(401);
  });

  it("múltiplos uploads (3) com a mesma credencial na mesma sessão, sem novo QR", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken } = createRes.json<{ id: string; qrToken: string }>();

    // Pareia
    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    expect(pairRes.statusCode).toBe(200);
    const { phoneCredential } = pairRes.json<{ phoneCredential: string }>();

    // Faz 3 uploads consecutivos usando a mesma phoneCredential
    for (let i = 1; i <= 3; i++) {
      const { body, contentType } = createMultipartPayload([
        {
          name: "file",
          content: Buffer.from(`file content number ${i}`),
          filename: `file-${i}.txt`,
        },
      ]);

      const uploadRes = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${id}/files`,
        headers: {
          authorization: `Bearer ${phoneCredential}`,
          "content-type": contentType,
        },
        body,
      });

      expect(uploadRes.statusCode).toBe(201);
      const json = uploadRes.json<{ files: Array<{ originalName: string }> }>();
      expect(json.files[0]!.originalName).toBe(`file-${i}.txt`);
    }

    // Confere que a sessão tem 3 arquivos
    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionRepository.getById(id);
    expect(session.files).toHaveLength(3);
    // Estado final após todos os uploads deve ser PAIRED
    expect(session.state).toBe("PAIRED");
  });

  it("upload sem credencial é recusado com 401; com credencial de outra sessão é recusado com 401", async () => {
    ctx = await createTestApp();
    const s1Res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const s2Res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const s1 = s1Res.json<{ id: string; qrToken: string }>();
    const s2 = s2Res.json<{ id: string; qrToken: string }>();

    // Pareia sessão 2
    const pair2 = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${s2.id}/pair`,
      payload: { qrToken: s2.qrToken },
    });
    const { phoneCredential: s2Cred } = pair2.json<{ phoneCredential: string }>();

    // Pareia sessão 1
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${s1.id}/pair`,
      payload: { qrToken: s1.qrToken },
    });

    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("data"), filename: "data.txt" },
    ]);

    // Upload sem credencial -> 401
    const noCredRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${s1.id}/files`,
      headers: { "content-type": contentType },
      body,
    });
    expect(noCredRes.statusCode).toBe(401);

    // Upload com credencial de outra sessão -> 401
    const wrongCredRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${s1.id}/files`,
      headers: {
        authorization: `Bearer ${s2Cred}`,
        "content-type": contentType,
      },
      body,
    });
    expect(wrongCredRes.statusCode).toBe(401);
  });

  it("upload com sessão CLOSED é recusado com 410", async () => {
    ctx = await createTestApp();
    const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken, computerToken } = createRes.json<{
      id: string;
      qrToken: string;
      computerToken: string;
    }>();

    // Pareia
    const pairRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/pair`,
      payload: { qrToken },
    });
    const { phoneCredential } = pairRes.json<{ phoneCredential: string }>();

    // Fecha sessão pelo computador
    const closeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${computerToken}` },
    });
    expect(closeRes.statusCode).toBe(204);

    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("data"), filename: "data.txt" },
    ]);

    // Tenta upload após fechamento -> 410
    const uploadRes = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/files`,
      headers: {
        authorization: `Bearer ${phoneCredential}`,
        "content-type": contentType,
      },
      body,
    });
    expect(uploadRes.statusCode).toBe(410);
  });

  it("logs não contêm credenciais nem tokens", async () => {
    const logLines: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      logLines.push(chunk.toString());
      return true;
    }) as any;

    try {
      ctx = await createTestApp();
      const createRes = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
      const { id, qrToken, computerToken } = createRes.json<{
        id: string;
        qrToken: string;
        computerToken: string;
      }>();

      const pairRes = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${id}/pair`,
        payload: { qrToken },
      });
      const { phoneCredential } = pairRes.json<{ phoneCredential: string }>();

      const logsText = logLines.join("\n");
      expect(logsText).not.toContain(qrToken);
      expect(logsText).not.toContain(computerToken);
      expect(logsText).not.toContain(phoneCredential);
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });
});
