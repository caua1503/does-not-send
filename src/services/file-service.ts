import { createWriteStream, type WriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Config } from "../utils/config.js";
import type { SessionRepository } from "../repositories/session-repository.js";
import type { SessionFile } from "../types.js";
import { generateStorageName } from "../utils/crypto.js";
import { sanitizeFilename } from "../utils/sanitize.js";
import { fileEvents } from "../utils/events.js";
import { extractExtension, categorize } from "../recording/normalize.js";
import type { SessionRecorder } from "../recording/index.js";
import type { Logger } from "../recording/index.js";
import { safeRecord } from "../utils/record-event.js";

export interface UploadResult {
  file: SessionFile;
}

export class FileService {
  constructor(
    private config: Config,
    private repository: SessionRepository,
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

    let writeStream: WriteStream | null = null;

    try {
      writeStream = createWriteStream(filePath);
      let bytesReceived = 0;

      await new Promise<void>((resolve, reject) => {
        const ws = writeStream!;

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

  getFilePath(sessionId: string, fileId: string): string {
    return join(this.config.tempDir, sessionId, fileId);
  }
}
