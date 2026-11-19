import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { get } from "node:http";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { cleanupTestApp, createSession, createTestApp, getAppContext, uploadFile } from "./helpers.js";

const gib = 1024 ** 3;
const run = promisify(execFile);

it.skipIf(process.env.TEST_ZIP64 !== "1")("extracts ZIP64 with a large entry and with large aggregate offsets", async () => {
  const ctx = await createTestApp();
  try {
    const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const { fileService } = getAppContext(ctx.app);
    for (const sizes of [[4 * gib + 1, 2], [2 * gib + 1, 2 * gib + 1, 2]]) {
      const session = await createSession(ctx.app);
      for (const [index, size] of sizes.entries()) {
        const file = await uploadFile(ctx.app, session, Buffer.from("A"), `entry-${index}.bin`);
        const fd = await open(fileService.getFilePath(session.id, file.id), "r+");
        try {
          await fd.truncate(size);
          await fd.write(Buffer.from("Z"), 0, 1, size - 1);
        } finally {
          await fd.close();
        }
      }

      const output = join(ctx.tempDir, `check-${sizes.length}.zip`);
      const fd = await open(output, "w");
      try {
        let offset = 0;
        const zeros = Buffer.alloc(1024 * 1024);
        const sparse = new Writable({
          write(chunk: Buffer, _encoding, done) {
            const start = offset;
            offset += chunk.length;
            if (chunk.length <= zeros.length && chunk.equals(zeros.subarray(0, chunk.length))) return done();
            void fd.write(chunk, 0, chunk.length, start).then(({ bytesWritten }) =>
              done(bytesWritten === chunk.length ? undefined : new Error("Short sparse write")),
            done);
          },
        });
        const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
          get(`${address}/api/sessions/${session.id}/download.zip`, {
            headers: { authorization: `Bearer ${session.ownerToken}` },
          }, resolve).once("error", reject);
        });
        expect(response.statusCode).toBe(200);
        await pipeline(response, sparse);
        await fd.truncate(offset);
      } finally {
        await fd.close();
      }

      const { stdout } = await run("python3", ["-c", `
import json, sys, zipfile
sizes = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as z:
    entries = z.infolist()
    assert [e.file_size for e in entries] == sizes
    assert entries[-1].header_offset > 2**32
    for i, info in enumerate(entries):
        assert info.filename == f"entry-{i}.bin"
        assert info.compress_type == zipfile.ZIP_STORED
        with z.open(info) as src:
            assert src.read(1) == b"A"
            total, last = 1, b""
            while data := src.read(1024 * 1024):
                total += len(data)
                last = data[-1:]
            assert total == sizes[i] and last == b"Z"
print("valid ZIP64")
`, output, JSON.stringify(sizes)]);
      expect(stdout.trim()).toBe("valid ZIP64");
      const details = await stat(output);
      expect(details.size).toBeGreaterThan(4 * gib);
      expect(details.blocks * 512).toBeLessThan(8 * 1024 * 1024);
    }
  } finally {
    await cleanupTestApp(ctx);
  }
}, 180_000);
