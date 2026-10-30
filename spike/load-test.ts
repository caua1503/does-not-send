/**
 * Load test: multiple large simultaneous uploads, memory measurement, cleanup verification.
 *
 * Run: bun run spike/load-test.ts
 */

import Fastify from "fastify";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/utils/config.js";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FILE_SIZE = 50 * 1024 * 1024; // 50MB each
const CONCURRENT_SESSIONS = 4;
const FILES_PER_SESSION = 2;

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), "dns-load-"));

  const config: Config = {
    host: "127.0.0.1",
    port: 9877,
    tempDir,
    maxFileSize: 200 * 1024 * 1024,
    maxFilesPerSession: 10,
    sessionIdleTimeout: 300_000,
    allowedOrigins: ["*"],
    publicBaseUrl: "http://localhost:9877",
  };

  const app = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });

  const baseUrl = `http://127.0.0.1:${config.port}`;

  console.log("=== Load Test ===");
  console.log(`${CONCURRENT_SESSIONS} sessions × ${FILES_PER_SESSION} files × ${FILE_SIZE / 1024 / 1024}MB = ${(CONCURRENT_SESSIONS * FILES_PER_SESSION * FILE_SIZE) / 1024 / 1024}MB total\n`);

  const memBefore = process.memoryUsage();
  console.log(`Memory before: RSS=${(memBefore.rss / 1024 / 1024).toFixed(1)}MB, Heap=${(memBefore.heapUsed / 1024 / 1024).toFixed(1)}MB`);

  // Create sessions
  const sessions: Array<{ id: string; ownerToken: string; uploadToken: string }> = [];
  for (let i = 0; i < CONCURRENT_SESSIONS; i++) {
    const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST" });
    sessions.push(await res.json() as { id: string; ownerToken: string; uploadToken: string });
  }

  // Upload files in parallel
  const start = Date.now();

  const uploadPromises = sessions.flatMap((session) =>
    Array.from({ length: FILES_PER_SESSION }, (_, i) => {
      const boundary = `----LoadTestBoundary${session.id}${i}`;
      let sent = 0;

      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="load-${i}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
            )
          );
        },
        pull(controller) {
          if (sent >= FILE_SIZE) {
            controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
            controller.close();
            return;
          }
          const chunk = new Uint8Array(Math.min(64 * 1024, FILE_SIZE - sent));
          chunk.fill(0x58);
          sent += chunk.length;
          controller.enqueue(chunk);
        },
      });

      return fetch(`${baseUrl}/api/sessions/${session.id}/files`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.uploadToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: bodyStream,
        // @ts-ignore
        duplex: "half",
      });
    })
  );

  const results = await Promise.all(uploadPromises);
  const elapsed = Date.now() - start;

  let allOk = true;
  for (const res of results) {
    if (res.status !== 201) {
      console.log(`❌ Upload failed: ${res.status} ${await res.text()}`);
      allOk = false;
    }
  }

  const memAfter = process.memoryUsage();
  console.log(`Memory after: RSS=${(memAfter.rss / 1024 / 1024).toFixed(1)}MB, Heap=${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(`RSS growth: ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1)}MB`);
  console.log(`Heap growth: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(1)}MB`);
  console.log(`Time: ${elapsed}ms`);
  console.log(`Throughput: ${((CONCURRENT_SESSIONS * FILES_PER_SESSION * FILE_SIZE) / 1024 / 1024 / (elapsed / 1000)).toFixed(1)} MB/s`);

  if (allOk) {
    console.log(`✅ All ${results.length} uploads succeeded`);
  }

  const totalData = CONCURRENT_SESSIONS * FILES_PER_SESSION * FILE_SIZE / 1024 / 1024;
  const heapGrowth = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  if (heapGrowth < totalData * 0.1) {
    console.log(`✅ Memory stable: ${heapGrowth.toFixed(1)}MB heap growth for ${totalData}MB data (< 10%)`);
  } else {
    console.log(`⚠️ Memory concern: ${heapGrowth.toFixed(1)}MB heap growth for ${totalData}MB data`);
  }

  // Close all sessions
  for (const session of sessions) {
    await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.ownerToken}` },
    });
  }

  // Check TEMP_DIR is empty
  await new Promise((r) => setTimeout(r, 200));
  const remaining = await readdir(tempDir).catch(() => []);
  if (remaining.length === 0) {
    console.log("✅ TEMP_DIR is empty after closing all sessions");
  } else {
    console.log(`❌ TEMP_DIR has ${remaining.length} entries: ${remaining.join(", ")}`);
  }

  // Cleanup
  const appCtx = (app as unknown as { ctx: { sessionService: { clearAllTimers(): void } } }).ctx;
  appCtx.sessionService.clearAllTimers();
  await app.close();
  await rm(tempDir, { recursive: true, force: true });

  console.log("\n=== Load Test Complete ===");
}

main().catch(console.error);
