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

export interface UploadResult {
  file: SessionFile;
}

export class FileService {
  constructor(
    private config: Config,
    private repository: SessionRepository,
  ) {}

  async handleFileUpload(
    sessionId: string,
    originalName: string,
    mimeType: string,
    stream: Readable,
    declaredSize?: number,
  ): Promise<UploadResult> {
    const session = this.repository.getById(sessionId);
    if (!session || session.state !== "active") {
      throw Object.assign(new Error("Session not available"), { statusCode: 404 });
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

    const fileRecord: SessionFile = {
      id: storageName,
      originalName: safeName,
      storageName,
      mimeType: mimeType || "application/octet-stream",
      size: declaredSize ?? 0,
      bytesReceived: 0,
      state: "receiving",
      createdAt: new Date().toISOString(),
    };

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

    let writeStream: WriteStream | null = null;

    try {
      writeStream = createWriteStream(filePath);
      let bytesReceived = 0;

      await new Promise<void>((resolve, reject) => {
        const ws = writeStream!;

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

      // Get actual file size from disk
      const fileStat = await stat(filePath);
      fileRecord.bytesReceived = fileStat.size;
      fileRecord.size = fileStat.size;
      fileRecord.state = "completed";
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

      return { file: fileRecord };
    } catch (err) {
      fileRecord.state = "failed";
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
