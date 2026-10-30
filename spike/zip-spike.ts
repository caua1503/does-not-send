/**
 * Spike: fflate streaming ZIP em Bun
 * Testa: arquivo 50MB via ZipPassThrough → sem buffer total em memória
 */
import { Zip, ZipPassThrough } from "fflate";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const inFile = join(tmpdir(), "spike-input.bin");
const outFile = join(tmpdir(), "spike-output.zip");

// Create 50MB test file
const chunk = Buffer.alloc(1024 * 1024, 0x41); // 1MB of 'A'
const chunks: Buffer[] = [];
for (let i = 0; i < 50; i++) chunks.push(chunk);
await writeFile(inFile, Buffer.concat(chunks));

const startMem = process.memoryUsage().heapUsed;

const zip = new Zip();
const ws = createWriteStream(outFile);

await new Promise<void>((resolve, reject) => {
  zip.ondata = (err, dat, final) => {
    if (err) { reject(err); return; }
    ws.write(dat);
    if (final) ws.end(resolve);
  };

  const entry = new ZipPassThrough("large-file.bin");
  zip.add(entry);

  const rs = createReadStream(inFile);
  rs.on("data", (chunk: Buffer) => entry.push(chunk, false));
  rs.on("end", () => { entry.push(new Uint8Array(0), true); zip.end(); });
  rs.on("error", reject);
});

const endMem = process.memoryUsage().heapUsed;
const memDeltaMB = ((endMem - startMem) / 1024 / 1024).toFixed(1);

console.log(`✅ ZIP gerado: ${outFile}`);
console.log(`   Delta heap: ${memDeltaMB}MB (esperado << 50MB)`);
console.log(`   Pass: ${Number(memDeltaMB) < 20 ? "✅ sem buffer total" : "❌ memória alta"}`);

await rm(inFile, { force: true });
await rm(outFile, { force: true });
