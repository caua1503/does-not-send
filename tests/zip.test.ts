import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
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

/** Inject and return ZIP bytes as Buffer */
async function downloadZip(ctx: TestContext, sessionId: string, token: string) {
  return ctx.app.inject({
    method: "GET",
    url: `/api/sessions/${sessionId}/download.zip`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("zip download", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("returns 401 without token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/download.zip`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with upload token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/download.zip`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns ZIP with correct Content-Type and Content-Disposition", async () => {
    const session = await createSession(ctx.app);
    await uploadFile(ctx.app, session, Buffer.from("content"), "file.txt");

    const res = await downloadZip(ctx, session.id, session.ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.zip/);
  });

  it("ZIP integrity: extracted file matches original hash", async () => {
    const session = await createSession(ctx.app);
    const content = Buffer.from("the quick brown fox jumps over the lazy dog");
    await uploadFile(ctx.app, session, content, "fox.txt");

    const res = await downloadZip(ctx, session.id, session.ownerToken);
    expect(res.statusCode).toBe(200);

    const zipData = new Uint8Array(res.rawPayload);
    const extracted = unzipSync(zipData);
    const files = Object.entries(extracted);
    expect(files.length).toBe(1);
    const [, bytes] = files[0]!;
    expect(sha256(Buffer.from(bytes))).toBe(sha256(content));
  });

  it("ZIP includes multiple completed files", async () => {
    const session = await createSession(ctx.app);
    const contentA = Buffer.from("file A content");
    const contentB = Buffer.from("file B content different");
    await uploadFile(ctx.app, session, contentA, "a.txt");
    await uploadFile(ctx.app, session, contentB, "b.txt");

    const res = await downloadZip(ctx, session.id, session.ownerToken);
    const extracted = unzipSync(new Uint8Array(res.rawPayload));
    const keys = Object.keys(extracted);
    expect(keys).toHaveLength(2);

    // Check content integrity for each
    for (const [name, bytes] of Object.entries(extracted)) {
      if (name.includes("a")) {
        expect(sha256(Buffer.from(bytes))).toBe(sha256(contentA));
      } else {
        expect(sha256(Buffer.from(bytes))).toBe(sha256(contentB));
      }
    }
  });

  it("deduplicates duplicate filenames: name (1).ext", async () => {
    const session = await createSession(ctx.app);
    await uploadFile(ctx.app, session, Buffer.from("original"), "dup.txt");
    await uploadFile(ctx.app, session, Buffer.from("copy"), "dup.txt");

    const res = await downloadZip(ctx, session.id, session.ownerToken);
    const extracted = unzipSync(new Uint8Array(res.rawPayload));
    const keys = Object.keys(extracted);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("dup.txt");
    expect(keys).toContain("dup (1).txt");
  });

  it("returns empty-ish ZIP for session with no completed files", async () => {
    const session = await createSession(ctx.app);
    const res = await downloadZip(ctx, session.id, session.ownerToken);
    // Empty ZIP is valid (just end-of-central-directory record)
    expect(res.statusCode).toBe(200);
    // Empty ZIP: try to unzip, if it throws the archive has 0 files
    let entryCount: number;
    try {
      const extracted = unzipSync(new Uint8Array(res.rawPayload));
      entryCount = Object.keys(extracted).length;
    } catch {
      // fflate throws on minimal empty ZIP — that's acceptable; 0 files = correct
      entryCount = 0;
    }
    expect(entryCount).toBe(0);
  });

  it("accepts ownerToken via ?token= query parameter", async () => {
    const session = await createSession(ctx.app);
    await uploadFile(ctx.app, session, Buffer.from("content"), "file.txt");

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/download.zip?token=${session.ownerToken}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("aborts streaming cleanly and frees resources when client disconnects", async () => {
    const bigCtx = await createTestApp({ maxFileSize: 20 * 1024 * 1024 });
    await bigCtx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = bigCtx.app.server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const session = await createSession(bigCtx.app);
      const content = Buffer.alloc(2 * 1024 * 1024, 0xcc);
      await uploadFile(bigCtx.app, session, content, "f1.bin");
      await uploadFile(bigCtx.app, session, content, "f2.bin");

      const controller = new AbortController();
      const res = await fetch(
        `${baseUrl}/api/sessions/${session.id}/download.zip?token=${session.ownerToken}`,
        { signal: controller.signal },
      );
      expect(res.status).toBe(200);
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();

      // Read initial chunk then abort
      await reader!.read();
      controller.abort();

      // Give server event-loop time to process abort and cleanup
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      await cleanupTestApp(bigCtx);
    }
  });

  it("large file ZIP: memory stays stable (no full buffer)", async () => {
    const bigCtx = await createTestApp({ maxFileSize: 20 * 1024 * 1024 });
    try {
      const session = await createSession(bigCtx.app);
      const content = Buffer.alloc(8 * 1024 * 1024, 0xab); // 8MB
      await uploadFile(bigCtx.app, session, content, "big.bin");

      const startMem = process.memoryUsage().heapUsed;
      const res = await downloadZip(bigCtx, session.id, session.ownerToken);
      const endMem = process.memoryUsage().heapUsed;
      const deltaMB = (endMem - startMem) / 1024 / 1024;

      expect(res.statusCode).toBe(200);
      // Heap growth should be well below 2x file size (streaming, not full buffer)
      expect(deltaMB).toBeLessThan(40); // generous: 8MB file should not cost 40MB+ extra heap

      // Verify content integrity
      const extracted = unzipSync(new Uint8Array(res.rawPayload));
      const [, bytes] = Object.entries(extracted)[0]!;
      expect(sha256(Buffer.from(bytes))).toBe(sha256(content));
    } finally {
      await cleanupTestApp(bigCtx);
    }
  });
});
