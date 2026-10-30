import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";

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

describe("isolation", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("session A cannot read session B files", async () => {
    const sA = await createSession(ctx.app);
    const sB = await createSession(ctx.app);

    // Upload to A
    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("secret-A"), filename: "a.txt" },
    ]);
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sA.id}/files`,
      headers: { authorization: `Bearer ${sA.uploadToken}`, "content-type": contentType },
      body,
    });

    // B tries to list A's files
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sA.id}/files`,
      headers: { authorization: `Bearer ${sB.ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("session A cannot upload to session B", async () => {
    const sA = await createSession(ctx.app);
    const sB = await createSession(ctx.app);

    const { body, contentType } = createMultipartPayload([
      { name: "file", content: Buffer.from("inject"), filename: "evil.txt" },
    ]);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sB.id}/files`,
      headers: { authorization: `Bearer ${sA.uploadToken}`, "content-type": contentType },
      body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("session A cannot close session B", async () => {
    const sA = await createSession(ctx.app);
    const sB = await createSession(ctx.app);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${sB.id}`,
      headers: { authorization: `Bearer ${sA.ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
