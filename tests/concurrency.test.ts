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

describe("concurrency", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ maxFilesPerSession: 100 });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("handles multiple sessions and uploads in parallel", async () => {
    const sessionCount = 5;
    const filesPerSession = 3;

    // Create sessions in parallel
    const sessions = await Promise.all(
      Array.from({ length: sessionCount }, () => createSession(ctx.app)),
    );

    // Upload files to all sessions in parallel
    const uploadPromises = sessions.flatMap((session) =>
      Array.from({ length: filesPerSession }, (_, i) => {
        const { body, contentType } = createMultipartPayload([
          {
            name: "file",
            content: Buffer.from(`data-${session.id}-${i}`),
            filename: `file-${i}.txt`,
          },
        ]);
        return ctx.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/files`,
          headers: {
            authorization: `Bearer ${session.uploadToken}`,
            "content-type": contentType,
          },
          body,
        });
      }),
    );

    const results = await Promise.all(uploadPromises);
    for (const res of results) {
      expect(res.statusCode).toBe(201);
    }

    // Verify each session has correct file count
    for (const session of sessions) {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/files`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().files).toHaveLength(filesPerSession);
    }

    // Close all sessions in parallel
    const closeResults = await Promise.all(
      sessions.map((s) =>
        ctx.app.inject({
          method: "DELETE",
          url: `/api/sessions/${s.id}`,
          headers: { authorization: `Bearer ${s.ownerToken}` },
        }),
      ),
    );
    for (const res of closeResults) {
      expect(res.statusCode).toBe(204);
    }
  });
});
