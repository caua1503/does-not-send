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

describe("concurrency: downloads and ZIPs", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ maxFilesPerSession: 20, maxFileSize: 5 * 1024 * 1024 });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("handles concurrent downloads from different sessions", async () => {
    const N = 4;
    const sessions = await Promise.all(Array.from({ length: N }, () => createSession(ctx.app)));
    const content = Buffer.alloc(512 * 1024, 0x42); // 512KB each

    // Upload one file per session
    const files = await Promise.all(
      sessions.map((s) => uploadFile(ctx.app, s, content, "data.bin")),
    );

    // Download all files in parallel
    const downloads = await Promise.all(
      sessions.map((s, i) =>
        ctx.app.inject({
          method: "GET",
          url: `/api/sessions/${s.id}/files/${files[i]!.id}/download`,
          headers: { authorization: `Bearer ${s.ownerToken}` },
        }),
      ),
    );

    for (const res of downloads) {
      expect(res.statusCode).toBe(200);
      expect(sha256(res.rawPayload)).toBe(sha256(content));
    }
  });

  it("handles concurrent ZIP downloads from different sessions", async () => {
    const N = 4;
    const sessions = await Promise.all(Array.from({ length: N }, () => createSession(ctx.app)));

    const contents = sessions.map((_, i) => Buffer.from(`session-${i}-content-xyz-${i * 1000}`));

    // Upload one file per session
    await Promise.all(
      sessions.map((s, i) => uploadFile(ctx.app, s, contents[i]!, `file-${i}.txt`)),
    );

    // Download ZIPs in parallel
    const zips = await Promise.all(
      sessions.map((s) =>
        ctx.app.inject({
          method: "GET",
          url: `/api/sessions/${s.id}/download.zip`,
          headers: { authorization: `Bearer ${s.ownerToken}` },
        }),
      ),
    );

    for (let i = 0; i < N; i++) {
      const res = zips[i]!;
      expect(res.statusCode).toBe(200);

      const extracted = unzipSync(new Uint8Array(res.rawPayload));
      const entries = Object.values(extracted);
      expect(entries).toHaveLength(1);
      expect(sha256(Buffer.from(entries[0]!))).toBe(sha256(contents[i]!));
    }
  });

  it("concurrent ZIP and download requests on same session do not interfere", async () => {
    const session = await createSession(ctx.app);
    const contentA = Buffer.from("file A data for concurrent test");
    const contentB = Buffer.from("file B data for concurrent test different");
    const fileA = await uploadFile(ctx.app, session, contentA, "a.txt");
    const fileB = await uploadFile(ctx.app, session, contentB, "b.txt");

    const [zipRes, dlA, dlB] = await Promise.all([
      ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/download.zip`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      }),
      ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/files/${fileA.id}/download`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      }),
      ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/files/${fileB.id}/download`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      }),
    ]);

    expect(zipRes.statusCode).toBe(200);
    expect(dlA.statusCode).toBe(200);
    expect(dlB.statusCode).toBe(200);

    expect(sha256(dlA.rawPayload)).toBe(sha256(contentA));
    expect(sha256(dlB.rawPayload)).toBe(sha256(contentB));

    const extracted = unzipSync(new Uint8Array(zipRes.rawPayload));
    expect(Object.keys(extracted)).toHaveLength(2);
  });
});
