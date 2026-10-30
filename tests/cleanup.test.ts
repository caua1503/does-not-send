import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";
import { readdir, mkdir, writeFile } from "node:fs/promises";
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
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("cleanup", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await cleanupTestApp(ctx);
  });

  it("closing session removes its directory", async () => {
    const session = await createSession(ctx.app);

    // Upload a file
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("data"), filename: "f.txt" },
    ]);
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
      body,
    });

    // Close
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });

    // Directory should be gone
    const entries = await readdir(ctx.config.tempDir).catch(() => []);
    expect(entries).not.toContain(session.id);
  });

  it("expired session removes its directory", async () => {
    const shortCtx = await createTestApp({ sessionIdleTimeout: 200 });
    try {
      const session = await createSession(shortCtx.app);

      // Upload a file
      const { body, contentType } = createMultipartPayload([
        { name: "file", content: Buffer.from("data"), filename: "f.txt" },
      ]);
      await shortCtx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/files`,
        headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": contentType },
        body,
      });

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 400));

      // Directory should be gone
      const entries = await readdir(shortCtx.config.tempDir).catch(() => []);
      expect(entries).not.toContain(session.id);
    } finally {
      await cleanupTestApp(shortCtx);
    }
  });

  it("orphan directories are cleaned on startup", async () => {
    // Create orphan directory
    const orphanDir = join(ctx.config.tempDir, "orphan-session-id");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "leftover.bin"), "stale data");

    // Rebuild app with same tempDir — orphan should be cleaned
    const { buildApp } = await import("../src/app.js");
    const newApp = await buildApp(ctx.config);

    const entries = await readdir(ctx.config.tempDir).catch(() => []);
    expect(entries).not.toContain("orphan-session-id");

    await newApp.close();
  });
});
