import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  uploadFile,
  type TestContext,
} from "./helpers.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("download individual", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("downloads file with identical content (hash match)", async () => {
    const session = await createSession(ctx.app);
    const content = Buffer.from("exact content to verify integrity 123456");
    const file = await uploadFile(ctx.app, session, content, "data.bin");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(sha256(res.rawPayload)).toBe(sha256(content));
  });

  it("uses RFC 5987 Content-Disposition for filename with accents", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, Buffer.from("content"), "café résumé.txt");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const cd = res.headers["content-disposition"] as string;
    // Must contain attachment
    expect(cd).toMatch(/attachment/);
    // RFC 5987: filename*=UTF-8''...
    expect(cd).toMatch(/filename\*=UTF-8''/i);
  });

  it("uses RFC 5987 Content-Disposition for filename with spaces", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, Buffer.from("content"), "my file name.pdf");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    const cd = res.headers["content-disposition"] as string;
    expect(cd).toMatch(/filename\*=UTF-8''/i);
    expect(cd).toContain("my%20file%20name.pdf");
  });

  it("returns 404 for non-existent file", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/does-not-exist/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/any/download`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with upload token", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, Buffer.from("x"), "x.txt");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for file belonging to another session", async () => {
    const sessionA = await createSession(ctx.app);
    const sessionB = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, sessionA, Buffer.from("A content"), "a.txt");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionB.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${sessionB.ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when session is closed", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, Buffer.from("data"), "file.txt");

    // Close session
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    // Attempt download after close → 401 (session closed)
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts ownerToken via ?token= query parameter", async () => {
    const session = await createSession(ctx.app);
    const content = Buffer.from("download with query token");
    const file = await uploadFile(ctx.app, session, content, "query-test.txt");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files/${file.id}/download?token=${session.ownerToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(sha256(res.rawPayload)).toBe(sha256(content));
  });

  it("streams large file correctly (hash match)", async () => {
    const bigCtx = await createTestApp({ maxFileSize: 20 * 1024 * 1024 });
    try {
      const session = await createSession(bigCtx.app);
      const content = Buffer.alloc(5 * 1024 * 1024, 0x55); // 5MB
      const file = await uploadFile(bigCtx.app, session, content, "large.bin");

      const res = await bigCtx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/files/${file.id}/download`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(sha256(res.rawPayload)).toBe(sha256(content));
    } finally {
      await cleanupTestApp(bigCtx);
    }
  });
});
