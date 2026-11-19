import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createTestApp,
  cleanupTestApp,
  createSession,
  uploadFile,
  createMultipartPayload,
  getAppContext,
  type TestContext,
} from "./helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open), stat: vi.fn(fs.stat) };
});

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

  it("serves bounded, open-ended and suffix ranges on both download paths", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "0123456789", "data.bin");
    const url = `/api/sessions/${session.id}/files/${file.id}`;
    for (const path of [url, url + "/download"]) {
      for (const [range, expected, contentRange] of [
        ["bytes=2-4", "234", "bytes 2-4/10"],
        ["bytes=7-", "789", "bytes 7-9/10"],
        ["bytes=-2", "89", "bytes 8-9/10"],
        ["bytes=8-100", "89", "bytes 8-9/10"],
      ]) {
        const response = await ctx.app.inject({ method: "GET", url: path,
          headers: { authorization: `Bearer ${session.ownerToken}`, range },
        });
        expect(response.statusCode).toBe(206);
        expect(response.headers["content-range"]).toBe(contentRange);
        expect(response.headers["content-length"]).toBe(String(expected!.length));
        expect(response.headers["cache-control"]).toContain("private");
        expect(response.body).toBe(expected);
      }
    }
  });

  it("reports the full length on HEAD without sending a body", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "0123456789", "data.bin");
    const response = await ctx.app.inject({
      method: "HEAD", url: `/api/sessions/${session.id}/files/${file.id}/download`,
      headers: { authorization: `Bearer ${session.ownerToken}`, range: "bytes=2-4" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-length"]).toBe("10");
    expect(response.body).toBe("");
  });

  it("returns 416 for invalid intervals without streaming any file bytes", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "0123456789", "data.bin");
    for (const range of ["bytes=10-", "bytes=6-4", "bytes=-0", "bytes=0-1,3-4", "bytes=1junk-2"]) {
      const response = await ctx.app.inject({
        method: "GET", url: `/api/sessions/${session.id}/files/${file.id}/download`,
        headers: { authorization: `Bearer ${session.ownerToken}`, range },
      });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe("bytes */10");
      expect(response.body).toBe("");
    }
  });

  it("pins the inode and version across an edit between metadata and streaming", async () => {
    const session = await createSession(ctx.app);
    const file = await uploadFile(ctx.app, session, "original", "data.bin");
    const path = getAppContext(ctx.app).fileService.getFilePath(session.id, file.id);
    const fileUrl = `/api/sessions/${session.id}/files/${file.id}`;
    const get = (range?: string, ifRange?: string) => ctx.app.inject({
      method: "GET", url: fileUrl + "/download",
      headers: { authorization: `Bearer ${session.ownerToken}`,
        ...(range ? { range } : {}), ...(ifRange ? { "if-range": ifRange } : {}) },
    });
    const before = await get();
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("brand-new-content"), filename: "data.bin" },
    ]);
    let edited = false;
    const replace = async () => {
      if (edited) return;
      edited = true;
      expect((await ctx.app.inject({
        method: "PUT", url: fileUrl,
        headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
        body,
      })).statusCode).toBe(200);
    };
    const { stat, open } = await vi.importActual<typeof fs>("node:fs/promises");
    const statSpy = vi.mocked(fs.stat).mockImplementation(async (...args) => {
      const info = await stat(...args);
      if (args[0] === path) await replace();
      return info;
    });
    const openSpy = vi.mocked(fs.open).mockImplementation(async (...args) => {
      const fd = await open(...args);
      if (args[0] === path) {
        const fstat = fd.stat.bind(fd);
        vi.spyOn(fd, "stat").mockImplementation(async (...statArgs) => {
          const info = await fstat(...statArgs);
          await replace();
          return info;
        });
      }
      return fd;
    });
    try {
      const during = await get();
      expect(edited).toBe(true);
      expect(during.body).toBe("original");
      expect(during.headers["content-length"]).toBe("8");
      expect(during.headers.etag).toBe(before.headers.etag);
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
    const stale = await get("bytes=0-2", String(before.headers.etag));
    expect(stale.statusCode).toBe(200);
    expect(stale.body).toBe("brand-new-content");
    expect(stale.headers.etag).not.toBe(before.headers.etag);
    const matched = await get("bytes=0-2", String(stale.headers.etag));
    expect(matched.statusCode).toBe(206);
    expect(matched.body).toBe("bra");
    const weak = await get("bytes=0-2", `W/${stale.headers.etag}`);
    expect(weak.statusCode).toBe(200);
    expect(weak.body).toBe("brand-new-content");
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
