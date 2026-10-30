import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "../src/utils/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createMultipartPayload(
  files: Array<{ name: string; content: Buffer; filename: string; contentType?: string }>,
): { body: Buffer; contentType: string } {
  const boundary = "----TestBoundary" + Date.now();
  const parts: Buffer[] = [];

  for (const file of files) {
    const ct = file.contentType ?? "application/octet-stream";
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${ct}\r\n\r\n`,
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

export interface TestContext {
  app: FastifyInstance;
  config: Config;
  tempDir: string;
}

export async function createTestApp(overrides?: Partial<Config>): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), "dns-test-"));

  const config: Config = {
    host: "127.0.0.1",
    port: 0,
    tempDir,
    maxFileSize: 10 * 1024 * 1024, // 10MB for tests
    maxFilesPerSession: 5,
    sessionIdleTimeout: 60_000,
    allowedOrigins: ["*"],
    publicBaseUrl: "http://localhost:3000",
    ...overrides,
  };

  const app = await buildApp(config);

  return { app, config, tempDir };
}

export async function cleanupTestApp(ctx: TestContext): Promise<void> {
  const appCtx = (ctx.app as unknown as { ctx: { sessionService: { clearAllTimers(): void } } })
    .ctx;
  appCtx.sessionService.clearAllTimers();
  await ctx.app.close();
  try {
    await rm(ctx.tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export interface SessionTokens {
  id: string;
  ownerToken: string;
  uploadToken: string;
}

export async function createSession(app: FastifyInstance): Promise<SessionTokens> {
  const res = await app.inject({
    method: "POST",
    url: "/api/sessions",
  });
  return res.json() as SessionTokens;
}

/** Upload a single file via multipart, returns parsed JSON result */
export async function uploadFile(
  app: FastifyInstance,
  session: SessionTokens,
  content: string | Buffer,
  filename: string,
  contentType = "application/octet-stream",
): Promise<{ id: string; originalName: string; size: number }> {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const { body, contentType: ct } = createMultipartPayload([
    { name: "file", content: buf, filename, contentType },
  ]);
  const res = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/files`,
    headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": ct },
    body,
  });
  const json = res.json() as { files: Array<{ id: string; originalName: string; size: number }> };
  return json.files[0]!;
}
