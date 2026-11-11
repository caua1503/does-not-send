import { createWriteStream, type WriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Config } from "../utils/config.js";
import type { SessionStore } from "../session/store.js";
import type { SessionFile } from "../types.js";
import { generateStorageName } from "../utils/crypto.js";
import { sanitizeFilename } from "../utils/sanitize.js";
import { fileEvents } from "../utils/events.js";
import { extractExtension, categorize } from "../recording/normalize.js";
import type { SessionRecorder } from "../recording/index.js";
import type { Logger } from "../recording/index.js";
import { safeRecord } from "../utils/record-event.js";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
};

export interface UploadResult {
  file: SessionFile;
}

// Client-supplied filename failures are 400s, not server errors.
function sanitizeFilenameOr400(name: string): string {
  try {
    return sanitizeFilename(name);
  } catch (err) {
    throw Object.assign(new Error((err as Error).message), { statusCode: 400 });
  }
}

export class FileService {
  constructor(
    private config: Config,
    private repository: SessionStore,
    private recorder?: SessionRecorder,
    private log: Logger = { info: () => {}, warn: () => {}, error: () => {} },
  ) {}

  async handleFileUpload(
    sessionId: string,
    originalName: string,
    mimeType: string,
    stream: Readable,
    declaredSize?: number,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    if (signal?.aborted) {
      throw Object.assign(new Error("Upload aborted"), { statusCode: 499 });
    }

    const session = this.repository.getById(sessionId);
    if (!session || session.state === "CLOSED") {
      throw Object.assign(new Error("Session not available"), { statusCode: 410 });
    }

    // Check file count limit
    const activeFiles = session.files.filter((f) => f.state !== "failed");
    if (activeFiles.length >= this.config.maxFilesPerSession) {
      throw Object.assign(new Error("File limit exceeded"), { statusCode: 413 });
    }

    // Sanitize filename
    const safeName = sanitizeFilename(originalName);
    const storageName = generateStorageName();
    const filePath = join(this.config.tempDir, sessionId, storageName);

    const now = new Date().toISOString();
    const fileRecord: SessionFile = {
      id: storageName,
      originalName: safeName,
      storageName,
      mimeType: mimeType || "application/octet-stream",
      size: declaredSize ?? 0,
      bytesReceived: 0,
      state: "receiving",
      createdAt: now,
      startedAt: now,
      version: 1,
      extension: extractExtension(safeName),
      category: "", // Will be calculated after extension is set
    };
    // Calculate category from extension and mime
    fileRecord.category = categorize(fileRecord.extension, fileRecord.mimeType);

    session.files.push(fileRecord);
    this.repository.update(session);

    fileEvents.emitFileEvent({
      type: "file:state-changed",
      sessionId,
      fileId: fileRecord.id,
      state: "receiving",
      originalName: safeName,
      size: fileRecord.size,
      bytesReceived: 0,
      version: fileRecord.version,
      mimeType: fileRecord.mimeType,
      extension: fileRecord.extension,
      category: fileRecord.category,
    });

    // Emit transfer_started event
    if (this.recorder) {
      safeRecord(
        this.recorder,
        {
          type: "transfer_started",
          at: new Date(now),
          id: fileRecord.id,
          sessionId,
          name: safeName,
          extension: fileRecord.extension,
          mime: fileRecord.mimeType,
          category: fileRecord.category as import("../recording/events.js").TransferStarted["category"],
          size: 0, // real size unknown at start; updated by transfer_finished
        },
        this.log,
      );
    }

    try {
      await this.pipeToFile(stream, createWriteStream(filePath), sessionId, fileRecord, signal);

      // Reverificar se sessão não foi fechada no meio
      const currentSession = this.repository.getById(sessionId);
      if (!currentSession || currentSession.state === "CLOSED") {
        try {
          await rm(filePath, { force: true });
        } catch {}
        throw Object.assign(new Error("Session closed during upload"), { statusCode: 410 });
      }

      // Get actual file size from disk
      const fileStat = await stat(filePath);
      fileRecord.bytesReceived = fileStat.size;
      fileRecord.size = fileStat.size;
      fileRecord.state = "completed";
      fileRecord.finishedAt = new Date().toISOString();
      this.repository.update(session);

      fileEvents.emitFileEvent({
        type: "file:state-changed",
        sessionId,
        fileId: fileRecord.id,
        state: "completed",
        originalName: safeName,
        size: fileStat.size,
        bytesReceived: fileStat.size,
        version: fileRecord.version,
        mimeType: fileRecord.mimeType,
        finishedAt: fileRecord.finishedAt,
        extension: fileRecord.extension,
        category: fileRecord.category,
      });

      // Emit transfer_finished event
      if (this.recorder) {
        safeRecord(
          this.recorder,
          {
            type: "transfer_finished",
            at: new Date(),
            id: fileRecord.id,
            status: "completed" as const,
            size: fileStat.size,
          },
          this.log,
        );
      }

      return { file: fileRecord };
    } catch (err) {
      fileRecord.state = "failed";
      fileRecord.finishedAt = new Date().toISOString();
      this.repository.update(session);

      fileEvents.emitFileEvent({
        type: "file:state-changed",
        sessionId,
        fileId: fileRecord.id,
        state: "failed",
        originalName: safeName,
        size: fileRecord.size,
        bytesReceived: fileRecord.bytesReceived,
        version: fileRecord.version,
        mimeType: fileRecord.mimeType,
        finishedAt: fileRecord.finishedAt,
        extension: fileRecord.extension,
        category: fileRecord.category,
      });

      // Emit transfer_finished event with failure
      if (this.recorder) {
        safeRecord(
          this.recorder,
          {
            type: "transfer_finished",
            at: new Date(),
            id: fileRecord.id,
            status: "failed" as const,
            size: fileRecord.bytesReceived,
          },
          this.log,
        );
      }

      // Clean up partial file
      try {
        await rm(filePath, { force: true });
      } catch {
        // ignore cleanup errors
      }

      throw err;
    }
  }

  /**
   * Replaces the content of an existing completed file, keeping its id.
   * The new content is written to a temp file in the same folder and renamed
   * over storageName, so in-flight downloads/ZIPs keep reading the old inode.
   */
  async replaceFile(
    sessionId: string,
    fileId: string,
    originalName: string,
    mimeType: string,
    stream: Readable,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    const session = this.repository.getById(sessionId);
    if (!session || session.state === "CLOSED") {
      throw Object.assign(new Error("Session not available"), { statusCode: 410 });
    }

    const fileRecord = session.files.find((f) => f.id === fileId);
    if (!fileRecord || fileRecord.state !== "completed") {
      throw Object.assign(new Error("File not found"), { statusCode: 404 });
    }

    // File uploads carry an OS basename, not a path: reject traversal targets
    // instead of letting sanitizeFilename silently rewrite them.
    if (originalName.split(/[/\\]/).pop() !== originalName) {
      throw Object.assign(new Error("Invalid filename"), { statusCode: 400 });
    }

    const nextMimeType = mimeType || "application/octet-stream";
    const safeName = sanitizeFilenameOr400(originalName);
    const ownExtension = extractExtension(safeName);
    const baseName = ownExtension
      ? safeName.slice(0, safeName.length - ownExtension.length - 1)
      : safeName;
    // New extension follows the MIME type; unknown types keep the current one.
    const mimeExtension = MIME_EXTENSIONS[nextMimeType.toLowerCase()];
    const nextExtension = mimeExtension ?? fileRecord.extension;
    const finalName = `${baseName}${nextExtension ? `.${nextExtension}` : ""}`;

    const finalPath = this.getFilePath(sessionId, fileRecord.storageName);
    // Unique per request: two concurrent replaces must not share a temp file.
    const tempPath = `${finalPath}.${generateStorageName()}.tmp`;
    const tempRecord: SessionFile = {
      ...fileRecord,
      size: 0,
      bytesReceived: 0,
      extension: nextExtension,
    };

    try {
      const writeStream = createWriteStream(tempPath);
      await this.pipeToFile(stream, writeStream, sessionId, tempRecord, signal);

      const currentSession = this.repository.getById(sessionId);
      if (!currentSession || currentSession.state === "CLOSED") {
        throw Object.assign(new Error("Session closed during upload"), { statusCode: 410 });
      }

      const fileStat = await stat(tempPath);
      await rename(tempPath, finalPath);

      fileRecord.originalName = finalName;
      fileRecord.mimeType = nextMimeType;
      fileRecord.size = fileStat.size;
      fileRecord.bytesReceived = fileStat.size;
      fileRecord.finishedAt = new Date().toISOString();
      fileRecord.version += 1;
      if (nextExtension) fileRecord.extension = nextExtension;
      fileRecord.category = categorize(fileRecord.extension, fileRecord.mimeType);
      this.repository.update(session);

      fileEvents.emitFileEvent({
        type: "file:state-changed",
        sessionId,
        fileId: fileRecord.id,
        state: "completed",
        originalName: fileRecord.originalName,
        size: fileRecord.size,
        bytesReceived: fileRecord.bytesReceived,
        version: fileRecord.version,
        mimeType: fileRecord.mimeType,
        finishedAt: fileRecord.finishedAt,
        extension: fileRecord.extension,
        category: fileRecord.category,
      });

      // Same recording path as a finished upload, so /admin follows the
      // replacement instead of diverging from memory.
      if (this.recorder) {
        safeRecord(
          this.recorder,
          {
            type: "transfer_finished",
            at: new Date(),
            id: fileRecord.id,
            status: "completed" as const,
            size: fileStat.size,
          },
          this.log,
        );
      }

      return { file: fileRecord };
    } catch (err) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  // Streams to disk with the same abort/size/progress rules for upload and replace.
  private pipeToFile(
    stream: Readable,
    ws: WriteStream,
    sessionId: string,
    fileRecord: SessionFile,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        stream.destroy();
        ws.destroy();
        reject(Object.assign(new Error("Upload aborted"), { statusCode: 499 }));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      let bytesReceived = 0;

      stream.on("data", (chunk: Buffer) => {
        bytesReceived += chunk.length;

        if (bytesReceived > this.config.maxFileSize) {
          stream.destroy();
          ws.destroy();
          reject(Object.assign(new Error("File too large"), { statusCode: 413 }));
          return;
        }

        fileRecord.bytesReceived = bytesReceived;

        fileEvents.emitFileEvent({
          type: "file:progress",
          sessionId,
          fileId: fileRecord.id,
          bytesReceived,
          size: fileRecord.size,
        });

        if (!ws.write(chunk)) {
          stream.pause();
          ws.once("drain", () => stream.resume());
        }
      });

      stream.on("end", () => {
        ws.end(() => resolve());
      });

      stream.on("error", (err) => {
        ws.destroy();
        reject(err);
      });

      ws.on("error", (err) => {
        stream.destroy();
        reject(err);
      });
    });
  }

  getFilePath(sessionId: string, fileId: string): string {
    return join(this.config.tempDir, sessionId, fileId);
  }
}
