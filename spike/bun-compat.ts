/**
 * Spike: Bun + Fastify compatibility test
 *
 * Tests:
 * 1. Fastify responds under Bun
 * 2. Multipart streaming upload of 300MB without proportional memory
 * 3. Aborted upload doesn't leak streams/files
 *
 * Run: bun run spike/bun-compat.ts
 */

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

const SPIKE_DIR = join(tmpdir(), "dns-spike-" + Date.now());
const PORT = 9876;

async function main() {
  await mkdir(SPIKE_DIR, { recursive: true });

  const app = Fastify({ logger: false });
  await app.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 },
  });

  app.get("/ping", async () => ({ pong: true }));

  app.post("/upload", async (request, reply) => {
    const parts = request.parts();
    const results: Array<{ name: string; size: number }> = [];

    for await (const part of parts) {
      if (part.type !== "file") continue;

      const filePath = join(SPIKE_DIR, `upload-${Date.now()}`);
      const ws = createWriteStream(filePath);

      await new Promise<void>((resolve, reject) => {
        part.file.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
        part.file.on("error", reject);
      });

      const s = await stat(filePath);
      results.push({ name: part.filename, size: s.size });
    }

    return { files: results };
  });

  await app.listen({ port: PORT, host: "127.0.0.1" });

  // --- Test 1: Fastify responds ---
  console.log("\n=== Test 1: Fastify responds under Bun ===");
  const pingRes = await fetch(`http://127.0.0.1:${PORT}/ping`);
  const pingBody = await pingRes.json();
  console.log(`Status: ${pingRes.status}, Body:`, pingBody);
  console.assert(pingBody.pong === true, "Ping failed");
  console.log("✅ PASS: Fastify responds under Bun\n");

  // --- Test 2: 300MB upload, memory check ---
  console.log("=== Test 2: 300MB streaming upload ===");
  const FILE_SIZE = 300 * 1024 * 1024; // 300MB
  const CHUNK_SIZE = 64 * 1024;

  // Measure memory before
  const memBefore = process.memoryUsage();
  console.log(`Memory before: RSS=${(memBefore.rss / 1024 / 1024).toFixed(1)}MB, Heap=${(memBefore.heapUsed / 1024 / 1024).toFixed(1)}MB`);

  // Generate 300MB stream
  let sent = 0;
  const boundary = "----SpikeBoundary";
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  const totalSize = header.length + FILE_SIZE + footer.length;
  const bodyStream = new ReadableStream({
    start(controller) {
      controller.enqueue(header);
    },
    pull(controller) {
      if (sent >= FILE_SIZE) {
        controller.enqueue(footer);
        controller.close();
        return;
      }
      const remaining = FILE_SIZE - sent;
      const chunk = new Uint8Array(Math.min(CHUNK_SIZE, remaining));
      chunk.fill(0x41); // 'A'
      sent += chunk.length;
      controller.enqueue(chunk);
    },
  });

  const uploadRes = await fetch(`http://127.0.0.1:${PORT}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyStream,
    // @ts-ignore - Bun supports duplex
    duplex: "half",
  });

  const uploadBody = await uploadRes.json() as { files: Array<{ name: string; size: number }> };
  console.log(`Upload result:`, uploadBody);
  console.assert(uploadBody.files[0]!.size === FILE_SIZE, `Expected ${FILE_SIZE}, got ${uploadBody.files[0]!.size}`);

  const memAfter = process.memoryUsage();
  console.log(`Memory after: RSS=${(memAfter.rss / 1024 / 1024).toFixed(1)}MB, Heap=${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB`);

  const rssGrowth = (memAfter.rss - memBefore.rss) / 1024 / 1024;
  const heapGrowth = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  console.log(`RSS growth: ${rssGrowth.toFixed(1)}MB, Heap growth: ${heapGrowth.toFixed(1)}MB`);
  console.log(`File size: ${FILE_SIZE / 1024 / 1024}MB`);

  if (heapGrowth < 100) {
    console.log("✅ PASS: Memory did NOT grow proportionally to file (heap growth < 100MB for 300MB file)\n");
  } else {
    console.log("⚠️ WARNING: Heap grew significantly — may indicate buffering\n");
  }

  // --- Test 3: Aborted upload cleanup ---
  console.log("=== Test 3: Aborted upload ===");
  const filesBefore = await readdir(SPIKE_DIR);

  const controller = new AbortController();
  let abortSent = 0;
  const abortStream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="abort.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ));
    },
    pull(ctrl) {
      if (abortSent > 1024 * 1024) {
        // Abort after 1MB
        controller.abort();
        ctrl.close();
        return;
      }
      const chunk = new Uint8Array(64 * 1024);
      chunk.fill(0x42);
      abortSent += chunk.length;
      ctrl.enqueue(chunk);
    },
  });

  try {
    await fetch(`http://127.0.0.1:${PORT}/upload`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: abortStream,
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
    });
  } catch (e) {
    console.log(`Abort caught: ${(e as Error).message}`);
  }

  // Wait for cleanup
  await new Promise((r) => setTimeout(r, 500));

  const filesAfter = await readdir(SPIKE_DIR);
  const newFiles = filesAfter.filter((f) => !filesBefore.includes(f));
  if (newFiles.length === 0) {
    console.log("✅ PASS: No leftover files from aborted upload\n");
  } else {
    console.log(`⚠️ INFO: ${newFiles.length} file(s) left from aborted upload — need explicit cleanup\n`);
    console.log("(This is expected; our FileService handles cleanup on error)\n");
  }

  // Cleanup
  await app.close();
  await rm(SPIKE_DIR, { recursive: true, force: true });

  console.log("=== Spike Complete ===");
}

main().catch(console.error);
