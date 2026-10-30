import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
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

describe("upload", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("uploads a single file", async () => {
    const session = await createSession(ctx.app);
    const content = Buffer.from("hello world");
    const { body, contentType } = createMultipartPayload([
      { name: "file", content, filename: "test.txt" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: {
        authorization: `Bearer ${session.uploadToken}`,
        "content-type": contentType,
      },
      body,
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result.files).toHaveLength(1);
    expect(result.files[0].originalName).toBe("test.txt");
    expect(result.files[0].size).toBe(content.length);
  });

  it("uploads multiple files", async () => {
    const session = await createSession(ctx.app);
    const { body, contentType } = createMultipartPayload([
      { name: "file1", content: Buffer.from("aaa"), filename: "a.txt" },
      { name: "file2", content: Buffer.from("bbb"), filename: "b.txt" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: {
        authorization: `Bearer ${session.uploadToken}`,
        "content-type": contentType,
      },
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().files).toHaveLength(2);
  });

  it("rejects upload exceeding file count limit", async () => {
    const smallCtx = await createTestApp({ maxFilesPerSession: 2 });
    try {
      const session = await createSession(smallCtx.app);

      // Upload 2 files (at limit)
      const { body: body1, contentType: ct1 } = createMultipartPayload([
        { name: "f1", content: Buffer.from("a"), filename: "a.txt" },
        { name: "f2", content: Buffer.from("b"), filename: "b.txt" },
      ]);
      const res1 = await smallCtx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/files`,
        headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": ct1 },
        body: body1,
      });
      expect(res1.statusCode).toBe(201);

      // 3rd upload should fail
      const { body: body2, contentType: ct2 } = createMultipartPayload([
        { name: "f3", content: Buffer.from("c"), filename: "c.txt" },
      ]);
      const res2 = await smallCtx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/files`,
        headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": ct2 },
        body: body2,
      });
      expect(res2.statusCode).toBe(413);
    } finally {
      await cleanupTestApp(smallCtx);
    }
  });

  it("rejects file exceeding size limit", async () => {
    const tinyCtx = await createTestApp({ maxFileSize: 100 });
    try {
      const session = await createSession(tinyCtx.app);
      const bigContent = Buffer.alloc(200, "x");
      const { body, contentType } = createMultipartPayload([
        { name: "file", content: bigContent, filename: "big.bin" },
      ]);

      const res = await tinyCtx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/files`,
        headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
        body,
      });
      // Fastify multipart plugin rejects oversized files
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await cleanupTestApp(tinyCtx);
    }
  });

  it("owner can list uploaded files", async () => {
    const session = await createSession(ctx.app);
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("data"), filename: "info.txt" },
    ]);

    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
      body,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.files).toHaveLength(1);
    expect(result.files[0].originalName).toBe("info.txt");
    expect(result.files[0].state).toBe("completed");
  });

  it("stores file with server-generated name, not original", async () => {
    const session = await createSession(ctx.app);
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("secret"), filename: "../../etc/passwd" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
      body,
    });

    if (res.statusCode === 201) {
      const result = res.json();
      // Original name should be sanitized
      expect(result.files[0].originalName).not.toContain("..");
      expect(result.files[0].originalName).not.toContain("/");

      // Check disk: no file named "passwd" or similar
      const dir = join(ctx.config.tempDir, session.id);
      const diskFiles = await readdir(dir);
      for (const f of diskFiles) {
        expect(f).not.toBe("passwd");
        expect(f).not.toContain("..");
      }
    }
  });
});
