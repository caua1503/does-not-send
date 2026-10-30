import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { AppContext } from "../app.js";
import { authorize } from "./sessions.js";

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

const VIDEO_AUDIO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".ogg",
  ".mov",
  ".avi",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".opus",
  ".oga",
]);

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

export async function downloadRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  // ─── Preview ───────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId/preview",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
      if (!auth) return;

      const session = ctx.sessionRepository.getById(auth.sessionId)!;
      const file = session.files.find((f) => f.id === request.params.fileId);

      if (!file || file.state !== "completed") {
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }

      const ext = extname(file.originalName).toLowerCase();
      const filePath = ctx.fileService.getFilePath(auth.sessionId, file.storageName);

      // Read first 16 bytes for magic-byte sniffing
      let magicMime: string | null = null;
      try {
        const { open } = await import("node:fs/promises");
        const fd = await open(filePath, "r");
        const buf = Buffer.alloc(16);
        await fd.read(buf, 0, 16, 0);
        await fd.close();
        magicMime = sniffMimeFromBytes(buf);
      } catch {
        // fallback to extension only
      }

      const allowedMime = INLINE_EXTENSIONS[ext];
      const isInlineAllowed = Boolean(allowedMime) && ext !== ".svg";
      const isVideoOrAudio = VIDEO_AUDIO_EXTENSIONS.has(ext);
      const resolvedMime = allowedMime ?? file.mimeType ?? "application/octet-stream";

      // Extra safety: if magic bytes contradict, fall back to non-inline
      const magicIsCompatible =
        magicMime === null || (allowedMime !== undefined && magicMime === allowedMime);

      const serveInline = isInlineAllowed && magicIsCompatible;

      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;

      // Security headers for preview
      void reply.header("X-Content-Type-Options", "nosniff");
      void reply.header("Content-Security-Policy", "sandbox");

      if (!serveInline) {
        // Unsafe type: force download
        const safeFileName = encodeURIComponent(file.originalName);
        void reply.header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${safeFileName}; filename="${safeFileName}"`,
        );
        void reply.header("Content-Type", "application/octet-stream");
        void reply.header("Content-Length", fileSize);
        const rs = createReadStream(filePath);
        return reply.send(rs);
      }

      // Range support for video/audio
      if (isVideoOrAudio) {
        void reply.header("Accept-Ranges", "bytes");
        const rangeHeader = request.headers["range"];
        if (rangeHeader) {
          const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = parseInt(match[1]!, 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            void reply.status(206);
            void reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
            void reply.header("Content-Length", chunkSize);
            void reply.header("Content-Type", resolvedMime);
            void reply.header(
              "Content-Disposition",
              `inline; filename="${encodeURIComponent(file.originalName)}"`,
            );
            const rs = createReadStream(filePath, { start, end });
            return reply.send(rs);
          }
        }
      }

      void reply.header(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(file.originalName)}"`,
      );
      void reply.header("Content-Type", resolvedMime);
      void reply.header("Content-Length", fileSize);

      const rs = createReadStream(filePath);
      return reply.send(rs);
    },
  );

  // ─── Download individual ───────────────────────────────────────────────────
  app.get<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId/download",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
      if (!auth) return;

      const session = ctx.sessionRepository.getById(auth.sessionId)!;
      const file = session.files.find((f) => f.id === request.params.fileId);

      if (!file || file.state !== "completed") {
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }

      const filePath = ctx.fileService.getFilePath(auth.sessionId, file.storageName);
      const { stat: fsStat } = await import("node:fs/promises");
      const fileStat = await fsStat(filePath);

      void reply.header("Content-Type", "application/octet-stream");
      void reply.header("Content-Disposition", rfc5987(file.originalName));
      void reply.header("Content-Length", fileStat.size);

      const rs = createReadStream(filePath);
      return reply.send(rs);
    },
  );

  // ─── ZIP download ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/sessions/:id/download.zip", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
    if (!auth) return;

    const session = ctx.sessionRepository.getById(auth.sessionId)!;
    const completedFiles = session.files.filter((f) => f.state === "completed");

    const sessionId = auth.sessionId;
    const zipFilename = `session-${sessionId.slice(0, 8)}.zip`;

    void reply.header("Content-Type", "application/zip");
    void reply.header("Content-Disposition", rfc5987(zipFilename));
    // No Content-Length — streaming, unknown size

    const { Zip, ZipPassThrough } = await import("fflate");
    const { PassThrough } = await import("node:stream");

    const passthrough = new PassThrough();

    // Start streaming immediately
    void reply.send(passthrough);

    let currentStream: ReturnType<typeof createReadStream> | null = null;

    const onClientClose = (): void => {
      if (!passthrough.destroyed) {
        passthrough.destroy();
      }
      if (currentStream && !currentStream.destroyed) {
        currentStream.destroy();
      }
    };

    request.raw.on("close", onClientClose);

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

    const zip = new Zip((err, dat, final) => {
      if (err) {
        passthrough.destroy(err);
        return;
      }
      if (!passthrough.destroyed) {
        passthrough.write(dat);
        if (final) passthrough.end();
      }
    });

    try {
      for (const file of completedFiles) {
        if (passthrough.destroyed) break;

        const zipName = dedupeFilename(file.originalName);
        const filePath = ctx.fileService.getFilePath(sessionId, file.storageName);

        await new Promise<void>((resolve, reject) => {
          const entry = new ZipPassThrough(zipName);
          zip.add(entry);

          const rs = createReadStream(filePath);
          currentStream = rs;

          rs.on("data", (chunk: Buffer) => {
            if (passthrough.destroyed) {
              rs.destroy();
              resolve();
              return;
            }
            entry.push(chunk, false);
          });

          rs.on("end", () => {
            currentStream = null;
            entry.push(new Uint8Array(0), true);
            resolve();
          });

          rs.on("error", (err) => {
            currentStream = null;
            entry.push(new Uint8Array(0), true);
            reject(err);
          });

          rs.on("close", () => {
            currentStream = null;
            resolve();
          });
        });

        if (passthrough.destroyed) break;
      }

      if (!passthrough.destroyed) {
        zip.end();
      }
    } catch (err) {
      if (!passthrough.destroyed) {
        passthrough.destroy(err as Error);
      }
    } finally {
      request.raw.off("close", onClientClose);
      const stream = currentStream as ReturnType<typeof createReadStream> | null;
      if (stream && !stream.destroyed) {
        stream.destroy();
      }
    }
  });
}
