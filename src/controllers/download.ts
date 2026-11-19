import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import { ZipFile } from "yazl";
import type { AppContext } from "../app.js";
import { authorize } from "./sessions.js";
import { canDownload, sessionMode } from "../session/permissions.js";

// ─── Preview allowlist ────────────────────────────────────────────────────────
// Extension → MIME (canonical)
const INLINE_EXTENSIONS: Record<string, string> = {
  // Images (not SVG — SVG can run scripts)
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  // PDF only (not HTML/SVG)
  ".pdf": "application/pdf",
};

/** Byte-level magic checks for common types (defence-in-depth) */
function sniffMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // GIF: GIF87a / GIF89a
  if (
    buf.subarray(0, 6).toString("ascii") === "GIF87a" ||
    buf.subarray(0, 6).toString("ascii") === "GIF89a"
  )
    return "image/gif";
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  // PDF: %PDF
  if (buf.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  // MP3: FF FB / FF F3 / FF F2 / ID3
  if (
    (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) ||
    (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33)
  )
    return "audio/mpeg";
  // Matroska/WebM: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

/** RFC 5987 encoding for Content-Disposition filenames */
export function rfc5987(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}; filename="${encodeURIComponent(filename)}"`;
}

type FileParams = { id: string; fileId: string };
type FileDelivery = "download" | "preview" | "attachment";

function byteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || !size) return null;
  const [, first, last] = match;
  if (!first) {
    const suffix = Number(last);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  return start <= end ? { start, end } : null;
}

async function deliverFile(
  ctx: AppContext,
  request: FastifyRequest<{ Params: FileParams }>,
  reply: FastifyReply,
  delivery: FileDelivery,
) {
  const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer", "phone"]);
  if (!auth) return;
  const session = ctx.sessionStore.getById(auth.sessionId)!;
  if (!canDownload(session, auth.participant)) {
    const status = sessionMode(session) === "oneway" ? 401 : 403;
    return reply.status(status).send({ error: "Unauthorized", statusCode: status });
  }

  const { fileId } = request.params;
  const opened = await ctx.fileService.withItemPublication(session.id, fileId, async () => {
    if (ctx.sessionStore.getById(session.id) !== session) return;
    const file = session.files.find((entry) => entry.id === fileId && entry.state === "completed");
    if (!file) return;
    const { originalName, mimeType, storageName, version } = file;
    try {
      const descriptor = await open(ctx.fileService.getFilePath(session.id, storageName), "r");
      return { descriptor, originalName, mimeType, version };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
  if (!opened) return reply.status(404).send({ error: "File not found", statusCode: 404 });

  const { descriptor, originalName, mimeType, version } = opened;
  let handedOff = false;
  try {
    const { size } = await descriptor.stat();
    const etag = `"${fileId}-v${version}"`;
    reply.header("ETag", etag)
      .header("Cache-Control", "private, no-cache")
      .header("Accept-Ranges", "bytes");

    let type = delivery === "attachment" ? mimeType : "application/octet-stream";
    let disposition = rfc5987(originalName);
    if (delivery === "preview") {
      reply.header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox");
      const allowedMime = INLINE_EXTENSIONS[extname(originalName).toLowerCase()];
      if (allowedMime) {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, 0);
        const magicMime = sniffMimeFromBytes(buffer.subarray(0, bytesRead));
        if (!magicMime || magicMime === allowedMime) {
          type = allowedMime;
          disposition = `inline; filename="${encodeURIComponent(originalName)}"`;
        }
      }
    }

    let start = 0;
    let end = size - 1;
    const { range, "if-range": ifRange } = request.headers;
    // The version ETag is strong. A stale/weak tag or date gets the whole current file.
    if (request.method === "GET" && range !== undefined && (ifRange === undefined || ifRange === etag)) {
      const interval = byteRange(range, size);
      if (!interval) {
        return reply.status(416).header("Content-Range", `bytes */${size}`).send();
      }
      ({ start, end } = interval);
      reply.status(206).header("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    reply.header("Content-Type", type)
      .header("Content-Disposition", disposition)
      .header("Content-Length", end - start + 1);

    if (request.method === "HEAD" || size === 0) return reply.send();
    const stream = descriptor.createReadStream({ start, end, autoClose: true });
    handedOff = true;
    return reply.send(stream);
  } finally {
    if (!handedOff) await descriptor.close();
  }
}

export async function downloadRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;
  const fileUrl = "/sessions/:id/files/:fileId";
  for (const [url, delivery] of [
    [fileUrl, "attachment"],
    [fileUrl + "/preview", "preview"],
    [fileUrl + "/download", "download"],
  ] as const) {
    // Explicit HEAD preserves the descriptor's size without opening a body stream.
    app.route<{ Params: FileParams }>({
      method: ["GET", "HEAD"],
      url,
      handler: (request, reply) => deliverFile(ctx, request, reply, delivery),
    });
  }

  // ─── ZIP download ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/sessions/:id/download.zip", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, [
      "owner",
      "computer",
      "phone",
    ]);
    if (!auth) return;

    const session = ctx.sessionStore.getById(auth.sessionId)!;
    if (!canDownload(session, auth.participant)) {
      const status = sessionMode(session) === "oneway" ? 401 : 403;
      return reply.status(status).send({ error: "Unauthorized", statusCode: status });
    }
    const completedFiles = session.files.filter((f) => f.state === "completed");

    const sessionId = auth.sessionId;
    const zipFilename = `session-${sessionId.slice(0, 8)}.zip`;

    void reply.header("Content-Type", "application/zip");
    void reply.header("Content-Disposition", rfc5987(zipFilename));
    // No Content-Length — streaming, unknown size

    const zip = new ZipFile();
    const output = zip.outputStream as import("node:stream").PassThrough;
    let currentStream: ReturnType<typeof createReadStream> | null = null;
    const onClientClose = () => output.destroy();
    reply.raw.once("close", onClientClose);
    output.once("close", () => {
      reply.raw.off("close", onClientClose);
      currentStream?.destroy();
    });
    zip.on("error", (error: Error) => output.destroy(error));

    // Deduplicate filenames
    const usedNames = new Set<string>();

    function dedupeFilename(original: string): string {
      if (!usedNames.has(original)) {
        usedNames.add(original);
        return original;
      }
      const ext = extname(original);
      const base = original.slice(0, original.length - ext.length);
      let counter = 1;
      while (true) {
        const candidate = `${base} (${counter})${ext}`;
        if (!usedNames.has(candidate)) {
          usedNames.add(candidate);
          return candidate;
        }
        counter++;
      }
    }

    try {
      for (const file of completedFiles) {
        const zipName = dedupeFilename(file.originalName);
        const filePath = ctx.fileService.getFilePath(sessionId, file.storageName);
        // yazl opens entries one at a time and pipes STORE bytes with backpressure.
        zip.addReadStreamLazy(zipName, { compress: false }, (ready) => {
          if (output.destroyed) return;
          const source = createReadStream(filePath);
          currentStream = source;
          source.once("error", (error) => output.destroy(error));
          source.once("close", () => {
            if (currentStream === source) currentStream = null;
          });
          ready(null, source);
        });
      }
      zip.end();
    } catch (error) {
      output.destroy();
      throw error;
    }
    return reply.send(output);
  });
}
