import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTestApp,
  createMultipartPayload,
  createSession,
  createTestApp,
  getAppContext,
  type TestContext,
} from "./helpers.js";

describe("regressão oneway", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("sessão criada sem mode é oneway", async () => {
    const session = await createSession(ctx.app, false);

    const info = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    expect(info.statusCode).toBe(200);
    expect(info.json().mode).toBe("oneway");
  });

  it("telefone envia e host baixa; telefone não lista nem baixa", async () => {
    const session = await createSession(ctx.app);
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("oneway"), filename: "oneway.txt" },
    ]);

    const upload = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
      body,
    });
    expect(upload.statusCode).toBe(201);
    const fileId = upload.json().files[0].id as string;

    const guestList = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(guestList.statusCode).toBe(401);

    const guestDownload = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${fileId}/download`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(guestDownload.statusCode).toBe(401);

    const hostDownload = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${fileId}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(hostDownload.statusCode).toBe(200);
    expect(hostDownload.rawPayload.toString()).toBe("oneway");
  });

  it("host do oneway mantém o envio permitido pelo contrato atual", async () => {
    const session = await createSession(ctx.app);
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("from-host"), filename: "host.txt" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}`, "content-type": contentType },
      body,
    });

    expect(res.statusCode).toBe(201);
  });

  it("QR não é de uso único e cada pareamento emite credencial nova", async () => {
    const session = await createSession(ctx.app, false);

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().phoneCredential).not.toBe(first.json().phoneCredential);
  });

  it("código numérico continua de uso único", async () => {
    const session = await createSession(ctx.app, false);
    const store = getAppContext(ctx.app).sessionStore;

    store.loginCodes.issue(session.id);
    const code = store.loginCodes.current(session.id)!.code;

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId: session.visualId, code },
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { sessionId: session.visualId, code },
    });
    expect(second.statusCode).toBe(401);
  });

  it("rota de participante com nome é recusada em oneway", async () => {
    const session = await createSession(ctx.app, false);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { qrToken: session.qrToken, name: "Ana", device: "phone" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("WRONG_MODE");
  });
});
