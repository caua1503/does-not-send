import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unzipSync } from "fflate";
import { FakeClock } from "../src/session/clock.js";
import { createTestApp, cleanupTestApp, createSession, createMultipartPayload, type SessionTokens, type TestContext } from "./helpers.js";

async function uploadText(
  ctx: TestContext,
  session: SessionTokens,
  text: string,
  filename = "Texto 14-32-05.txt",
) {
  const { body, contentType } = createMultipartPayload([
    { name: "files", content: Buffer.from(text, "utf8"), filename, contentType: "text/plain; charset=utf-8" },
  ]);
  return ctx.app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/files?kind=text`,
    headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
    body,
  });
}

describe("text upload", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ maxFilesPerSession: 30 });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("rejects empty text", async () => {
    const session = await createSession(ctx.app);
    const res = await uploadText(ctx, session, "");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/vazio/i);
  });

  it("rejects whitespace-only text", async () => {
    const session = await createSession(ctx.app);
    const res = await uploadText(ctx, session, "   \n\t  ");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/vazio/i);
  });

  it("rejects text above 10000 characters", async () => {
    const session = await createSession(ctx.app);
    const res = await uploadText(ctx, session, "a".repeat(10_001));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/10000/);
  });

  it("stores text as a file item with .txt name, UTF-8 size and text mime", async () => {
    const session = await createSession(ctx.app);
    const text = "olá mundo\nsegunda linha";
    const res = await uploadText(ctx, session, text);

    expect(res.statusCode).toBe(201);
    const item = res.json().files[0];
    expect(item.kind).toBe("text");
    expect(item.originalName).toBe("Texto 14-32-05.txt");
    expect(item.size).toBe(Buffer.byteLength(text, "utf8"));

    const list = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const listed = list.json().files[0];
    expect(listed.kind).toBe("text");
    expect(listed.mimeType).toBe("text/plain; charset=utf-8");
    expect(listed.state).toBe("completed");

    const preview = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${item.id}/preview?token=${session.ownerToken}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toBe(text);
  });

  it("appends numeric suffix to duplicate text names", async () => {
    const session = await createSession(ctx.app);
    const first = await uploadText(ctx, session, "um");
    const second = await uploadText(ctx, session, "dois");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().files[0].originalName).toBe("Texto 14-32-05.txt");
    expect(second.json().files[0].originalName).toBe("Texto 14-32-05 (2).txt");
  });

  it("includes text in the ZIP download", async () => {
    const session = await createSession(ctx.app);
    const text = "conteúdo para o zip";
    const upload = await uploadText(ctx, session, text);

    const zip = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/download.zip?token=${session.ownerToken}`,
    });
    expect(zip.statusCode).toBe(200);
    const extracted = unzipSync(new Uint8Array(zip.rawPayload));
    const bytes = extracted["Texto 14-32-05.txt"];
    expect(bytes).toBeDefined();
    expect(Buffer.from(bytes!).toString("utf8")).toBe(text);

    const files = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(files.json().files).toHaveLength(1);
    expect(files.json().files[0].id).toBe(upload.json().files[0].id);
  });

  it("rate limits text uploads per session", async () => {
    const clock = new FakeClock(Date.now());
    const limitedCtx = await createTestApp({ maxFilesPerSession: 30 }, { clock });
    try {
      const session = await createSession(limitedCtx.app);
      for (let i = 0; i < 10; i++) {
        const res = await uploadText(limitedCtx, session, `texto ${i}`);
        expect(res.statusCode).toBe(201);
      }
      const blocked = await uploadText(limitedCtx, session, "texto 11");
      expect(blocked.statusCode).toBe(429);

      clock.advance(10_000);
      const resumed = await uploadText(limitedCtx, session, "depois da janela");
      expect(resumed.statusCode).toBe(201);
    } finally {
      await cleanupTestApp(limitedCtx);
    }
  });
});
