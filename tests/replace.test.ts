import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  createMultipartPayload,
  uploadFile,
  type TestContext,
  type SessionTokens,
} from "./helpers.js";
import type { SessionFile } from "../src/types.js";
import type { AppContext } from "../src/app.js";

function appCtx(ctx: TestContext): AppContext {
  return (ctx.app as unknown as { ctx: AppContext }).ctx;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function replaceFile(
  ctx: TestContext,
  session: SessionTokens,
  fileId: string,
  content: string | Buffer,
  filename: string,
  contentType = "application/octet-stream",
  token = session.uploadToken,
) {
  const { body, contentType: ct } = createMultipartPayload([
    {
      name: "file",
      content: Buffer.isBuffer(content) ? content : Buffer.from(content),
      filename,
      contentType,
    },
  ]);
  return ctx.app.inject({
    method: "PUT",
    url: `/api/sessions/${session.id}/files/${fileId}`,
    headers: { authorization: `Bearer ${token}`, "content-type": ct },
    body,
  });
}

describe("replace file", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("keeps the same fileId, bumps version and serves the new content", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, Buffer.from("v1 content"), "photo.jpg", "image/jpeg");

    const res = await replaceFile(ctx, session, file.id, "v2 content!", "photo.jpg", "image/jpeg");

    expect(res.statusCode).toBe(200);
    const replaced = res.json().file;
    expect(replaced.id).toBe(file.id);
    expect(replaced.version).toBe(2);
    expect(replaced.size).toBe("v2 content!".length);
    expect(replaced.bytesReceived).toBe("v2 content!".length);
    expect(replaced.state).toBe("completed");
    expect(replaced.finishedAt).toBeTruthy();

    const download = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString()).toBe("v2 content!");

    const preview = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/preview`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.rawPayload.toString()).toBe("v2 content!");
  });

  it("keeps only one entry and version in the file list", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "a", "doc.txt");

    await replaceFile(ctx, session, file.id, "b", "doc.txt");
    await replaceFile(ctx, session, file.id, "c", "doc.txt");

    const list = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const files = list.json().files as Array<{ id: string; version: number; size: number }>;
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe(file.id);
    expect(files[0]!.version).toBe(3);
    expect(files[0]!.size).toBe(1);
  });

  it("does not count as a new file against maxFilesPerSession", async () => {
    const smallCtx = await createTestApp({ maxFilesPerSession: 1 });
    try {
      const session = await createSession(smallCtx.app);
      const file = await uploadFile(smallCtx.app, session, "original", "a.txt");

      const res = await replaceFile(smallCtx, session, file.id, "replaced", "a.txt");
      expect(res.statusCode).toBe(200);
      expect(res.json().file.version).toBe(2);
    } finally {
      await cleanupTestApp(smallCtx);
    }
  });

  it("updates extension and category when the replaced mimeType changes", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "plain", "notes.txt", "text/plain");

    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = await replaceFile(ctx, session, file.id, jpegMagic, "notes.png", "image/jpeg");
    expect(res.statusCode).toBe(200);
    expect(res.json().file.originalName).toBe("notes.jpg");

    const list = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(list.json().files[0].originalName).toBe("notes.jpg");

    const preview = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/preview`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-disposition"]).toMatch(/inline/);
    expect(preview.headers["content-type"]).toMatch(/image\/jpeg/);

    const stored = appCtx(ctx).sessionStore
      .getById(session.id)!
      .files.find((f: SessionFile) => f.id === file.id)!;
    expect(stored.extension).toBe("jpg");
    expect(stored.category).toBe("images");
  });

  it("rejects a computer/owner token (phone only)", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "x", "a.txt");

    const res = await replaceFile(ctx, session, file.id, "y", "a.txt", "text/plain", session.ownerToken);
    expect(res.statusCode).toBe(401);
  });

  it("rejects unknown or not-yet-completed fileId", async () => {
    const session = await createSession(ctx.app);

    const missing = await replaceFile(ctx, session, "does-not-exist", "y", "a.txt");
    expect(missing.statusCode).toBe(404);

    const owner = appCtx(ctx).sessionStore.getById(session.id)!;
    const stale: SessionFile = {
      id: "stale-file",
      originalName: "stale.txt",
      storageName: "stale-file",
      mimeType: "text/plain",
      size: 1,
      bytesReceived: 0,
      state: "receiving",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      version: 1,
      extension: "txt",
      category: "documents",
    };
    owner.files.push(stale);

    const res = await replaceFile(ctx, session, stale.id, "y", "stale.txt");
    expect(res.statusCode).toBe(404);
  });

  it("rejects replacement in a closed session", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "x", "a.txt");

    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    // authorize() recusa sessão CLOSED antes de chegar ao estado — 401
    const res = await replaceFile(ctx, session, file.id, "y", "a.txt");
    expect(res.statusCode).toBe(401);
  });

  it("rejects replacement while session is DISCONNECTED (invalid state)", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "x", "a.txt");

    const live = appCtx(ctx).sessionStore.getById(session.id)!;
    live.state = "DISCONNECTED";

    const res = await replaceFile(ctx, session, file.id, "y", "a.txt");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("keeps the hash of a large file intact after replacement", async () => {
    const session = await createSession(ctx.app);
    const v1 = Buffer.alloc(1024, 0x11);
    const v2 = Buffer.alloc(3 * 1024, 0x66);
    const file = await uploadFile(ctx.app, session, v1, "big.bin");

    const res = await replaceFile(ctx, session, file.id, v2, "big.bin");
    expect(res.statusCode).toBe(200);

    const download = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(sha256(download.rawPayload)).toBe(sha256(v2));
  });
});
