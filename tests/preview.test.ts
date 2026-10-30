import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  uploadFile,
  type TestContext,
} from "./helpers.js";

// Minimal magic bytes for type sniffing
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(8)]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF_BYTES = Buffer.from("%PDF-1.4 fake content for test", "ascii");
const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(20)]); // WebM matroska
const MP3_BYTES = Buffer.from([0xff, 0xfb, ...Buffer.alloc(100)]); // MP3 sync word
const HTML_BYTES = Buffer.from("<html><body>evil</body></html>", "utf8");
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
const JS_BYTES = Buffer.from("alert('xss')", "utf8");

async function previewRequest(
  ctx: TestContext,
  sessionId: string,
  fileId: string,
  token: string,
  headers?: Record<string, string>,
) {
  return ctx.app.inject({
    method: "GET",
    url: `/api/sessions/${sessionId}/files/${fileId}/preview`,
    headers: { authorization: `Bearer ${token}`, ...(headers ?? {}) },
  });
}

describe("preview", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("serves PNG inline", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, PNG_BYTES, "image.png", "image/png");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
  });

  it("serves JPEG inline", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, JPEG_BYTES, "photo.jpg", "image/jpeg");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
  });

  it("serves PDF inline", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, PDF_BYTES, "doc.pdf", "application/pdf");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
    expect(res.headers["content-type"]).toMatch(/pdf/);
  });

  it("serves video inline with Content-Type and Range support headers", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, WEBM_BYTES, "video.webm", "video/webm");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
    expect(res.headers["accept-ranges"]).toBe("bytes");
  });

  it("serves audio inline", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, MP3_BYTES, "sound.mp3", "audio/mpeg");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
  });

  it("NEVER serves HTML inline — forces download", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, HTML_BYTES, "evil.html", "text/html");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    // Must be attachment, never inline
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).not.toMatch(/inline/);
  });

  it("NEVER serves SVG inline — forces download", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, SVG_BYTES, "icon.svg", "image/svg+xml");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).not.toMatch(/inline/);
  });

  it("NEVER serves JS inline — forces download", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(
      ctx.app,
      session,
      JS_BYTES,
      "script.js",
      "application/javascript",
    );
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("sends security headers on preview", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, PNG_BYTES, "img.png", "image/png");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/sandbox/);
  });

  it("supports Range request for video", async () => {
    const session = await createSession(ctx.app);
    // Need enough bytes for a range request
    const videoBuf = Buffer.concat([WEBM_BYTES, Buffer.alloc(1000, 0xab)]);
    const file = await uploadFile(ctx.app, session, videoBuf, "clip.webm", "video/webm");
    const res = await previewRequest(ctx, session.id, file.id, session.ownerToken, {
      range: "bytes=0-9",
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toMatch(/bytes 0-9\//);
    expect(res.rawPayload.length).toBe(10);
  });

  it("denies preview of file from another session", async () => {
    const sessionA = await createSession(ctx.app);
    const sessionB = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, sessionA, PNG_BYTES, "img.png", "image/png");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionB.id}/files/${file.id}/preview`,
      headers: { authorization: `Bearer ${sessionB.ownerToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for non-existent file", async () => {
    const session = await createSession(ctx.app);
    const res = await previewRequest(ctx, session.id, "does-not-exist", session.ownerToken);
    expect(res.statusCode).toBe(404);
  });

  it("accepts ownerToken via ?token= query parameter", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, PNG_BYTES, "image.png", "image/png");
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/preview?token=${session.ownerToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/inline/);
  });

  it("returns 401 without token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/any/preview`,
    });
    expect(res.statusCode).toBe(401);
  });
});
