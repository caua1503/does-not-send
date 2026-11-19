import { createWriteStream, type WriteStream } from "node:fs";
import { rename, rm, stat, statfs, truncate } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Readable as ReadableStream } from "node:stream";
import type { Config } from "../utils/config.js";
import type { SessionStore } from "../session/store.js";
import type { Participant, Session, SessionFile } from "../types.js";
import { generateStorageName } from "../utils/crypto.js";
import { sanitizeFilename } from "../utils/sanitize.js";
import { fileEvents } from "../utils/events.js";
import { extractExtension, categorize } from "../recording/normalize.js";
import type { SessionRecorder } from "../recording/index.js";
import type { Logger } from "../recording/index.js";
import { safeRecord } from "../utils/record-event.js";
import { RESUMABLE_UPLOAD_CHUNK_BYTES, type TransferCheckpoint } from "../shared/resumable-upload.js";
import { itemAddedEvent, TWOWAY_DEFAULTS } from "../session/twoway.js";

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

const TEXT_MAX_LENGTH = 10_000;
// UTF-8 uses at most 4 bytes per code unit, so this bound can never hide text
// that would be within the character limit.
const TEXT_MAX_BYTES = TEXT_MAX_LENGTH * 4 + 1;
const TEXT_MIME = "text/plain; charset=utf-8";

function uniqueTextName(files: SessionFile[], name: string): string {
  const used = new Set(
    files.filter((f) => f.kind === "text").map((f) => f.originalName),
  );
  if (!used.has(name)) return name;
  const ext = name.toLowerCase().endsWith(".txt") ? ".txt" : "";
  const base = ext ? name.slice(0, -ext.length) : name;
  let counter = 2;
  while (used.has(`${base} (${counter})${ext}`)) counter++;
  return `${base} (${counter})${ext}`;
}

function uploadAborted(): Error {
  return Object.assign(new Error("Upload aborted"), { statusCode: 499 });
}

function readStream(stream: Readable, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    function cleanup() {
      stream.off("data", onData).off("end", onEnd).off("error", fail).off("close", onAbort);
      signal?.removeEventListener("abort", onAbort);
    }

    function fail(err: Error) {
      cleanup();
      stream.destroy();
      reject(err);
    }

    function onAbort() {
      fail(uploadAborted());
    }

    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks, total));
    }

    function onData(chunk: Buffer) {
      total += chunk.length;
      if (total > maxBytes) {
        fail(Object.assign(new Error("Texto excede o limite de 10000 caracteres"), { statusCode: 400 }));
        return;
      }
      chunks.push(chunk);
    }

    stream.once("end", onEnd).once("error", fail).once("close", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted || stream.destroyed) onAbort();
    else stream.on("data", onData);
  });
}

function checkFileSize(stream: Readable & { truncated?: boolean }, size: number, limit: number): void {
  if (stream.truncated || size > limit) {
    throw Object.assign(new Error("File too large"), { statusCode: 413 });
  }
}

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

function storageError(err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") {
    return Object.assign(new Error("Insufficient storage space", { cause: err }), { statusCode: 507 });
  }
  return err;
}

interface StorageReservation {
  sessionId: string;
  bytes: number;
  volumeLimit: number;
}

const PARTIAL_TRANSFER_TTL_MS = 10 * 60_000;
const MAX_TRANSFERS_PER_SESSION = 1024;

export interface TransferMetadata {
  name: string;
  mimeType: string;
  size: number;
  originalSize: number | null;
}

interface ResumableTransfer {
  owner: string;
  metadata: TransferMetadata;
  file: SessionFile;
  offset: number;
  writing: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function transferError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export class FileService {
  private transfers = new WeakMap<Session, Map<string, ResumableTransfer>>();
  private partialBytes = new WeakMap<SessionFile, number>();
  private expiryTimers = new Set<ReturnType<typeof setTimeout>>();
  private reservations = new Set<StorageReservation>();
  private itemPublications = new Map<string, Promise<void>>();
  private stopListeningForClose: () => void;

  constructor(
    private config: Config,
    private repository: SessionStore,
    private recorder?: SessionRecorder,
    private log: Logger = { info: () => {}, warn: () => {}, error: () => {} },
  ) {
    this.stopListeningForClose = repository.onSessionClosing((session) => {
      for (const transfer of this.transfers.get(session)?.values() ?? []) {
        this.clearExpiry(transfer);
        this.partialBytes.delete(transfer.file);
        if (transfer.file.state === "receiving") {
          this.finishFileUpload(session, transfer.file, "failed", transfer.offset);
        }
      }
      this.transfers.delete(session);
    });
  }

  async handleFileUpload(
    sessionId: string,
    originalName: string,
    mimeType: string,
    stream: Readable,
    declaredSize?: number,
    signal?: AbortSignal,
    kind?: "text",
    originalSize?: number | null,
  ): Promise<UploadResult> {
    if (signal?.aborted) {
      throw uploadAborted();
    }

    const session = this.repository.getById(sessionId);
    if (!session || session.state === "CLOSED") {
      throw Object.assign(new Error("Session not available"), { statusCode: 410 });
    }

    let uploadStream = stream;
    let uploadSize = declaredSize;
    if (kind === "text") {
      const raw = await readStream(stream, TEXT_MAX_BYTES, signal);
      checkFileSize(stream, raw.length, this.config.maxFileSize);
      const text = raw.toString("utf8").trim();
      if (text.length === 0) {
        throw Object.assign(new Error("Texto não pode ser vazio"), { statusCode: 400 });
      }
      if (text.length > TEXT_MAX_LENGTH) {
        throw Object.assign(
          new Error("Texto excede o limite de 10000 caracteres"),
          { statusCode: 400 },
        );
      }
      if (!this.repository.allowTextUpload(sessionId)) {
        throw Object.assign(
          new Error("Muitos textos enviados. Aguarde alguns segundos."),
          { statusCode: 429 },
        );
      }
      const content = Buffer.from(text, "utf8");
      uploadStream = ReadableStream.from(content);
      uploadSize = content.length;
    }

    const fileRecord = this.beginFileUpload(session, originalName, mimeType, uploadSize, originalSize, kind);
    const filePath = this.getFilePath(sessionId, fileRecord.storageName);

    let reservation: StorageReservation | undefined;
    try {
      reservation = await this.reserveStorage(sessionId);
      await this.pipeToFile(uploadStream, createWriteStream(filePath), reservation, fileRecord, signal);

      const { size } = await stat(filePath);
      this.requireActiveUploadSession(session);
      if (signal?.aborted) throw uploadAborted();
      this.reservations.delete(reservation);
      this.finishFileUpload(session, fileRecord, "completed", size);
      return { file: fileRecord };
    } catch (err) {
      this.finishFileUpload(session, fileRecord, "failed", fileRecord.bytesReceived);
      // Clean up partial file
      try {
        await rm(filePath, { force: true });
      } catch {
        // ignore cleanup errors
      }

      throw storageError(err);
    } finally {
      if (reservation) this.reservations.delete(reservation);
    }
  }

  private beginFileUpload(
    session: Session,
    originalName: string,
    mimeType: string,
    uploadSize: number | undefined,
    originalSize?: number | null,
    kind?: "text",
    sender?: Participant,
  ): SessionFile {
    const sessionId = session.id;
    // Check file count limit
    const activeFiles = session.files.filter((f) => f.state !== "failed");
    if (activeFiles.length >= this.config.maxFilesPerSession) {
      throw Object.assign(new Error("File limit exceeded"), { statusCode: 413 });
    }

    // Sanitize filename
    let safeName = sanitizeFilenameOr400(originalName);
    let effectiveMime = mimeType || "application/octet-stream";
    if (kind === "text") {
      if (!safeName.toLowerCase().endsWith(".txt")) safeName = `${safeName}.txt`;
      safeName = uniqueTextName(session.files, safeName);
      effectiveMime = TEXT_MIME;
    }
    const storageName = generateStorageName();

    const now = new Date().toISOString();
    const fileRecord: SessionFile = {
      id: storageName,
      originalName: safeName,
      storageName,
      mimeType: effectiveMime,
      size: uploadSize ?? 0,
      bytesReceived: 0,
      originalSize: originalSize ?? null,
      state: "receiving",
      createdAt: now,
      startedAt: now,
      version: 1,
      extension: extractExtension(safeName),
      category: "", // Will be calculated after extension is set
      ...(kind === "text" ? { kind } : {}),
      senderId: sender?.id,
      senderName: sender?.name,
      origin: sender?.device,
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
      kind: fileRecord.kind,
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
          originalSize: fileRecord.originalSize,
        },
        this.log,
      );
    }

    return fileRecord;
  }

  private requireActiveUploadSession(session: Session): void {
    if (this.repository.getById(session.id) !== session || session.state === "CLOSED") {
      throw transferError(410, "Session closed during upload");
    }
  }

  private finishFileUpload(
    session: Session, file: SessionFile, state: "completed" | "failed", bytes: number,
  ): void {
    file.state = state;
    if (state === "completed") {
      file.size = bytes;
      file.bytesReceived = bytes;
    }
    file.finishedAt = new Date().toISOString();
    this.repository.update(session);
    fileEvents.emitFileEvent({
      type: "file:state-changed",
      sessionId: session.id,
      fileId: file.id,
      state,
      originalName: file.originalName,
      size: file.size,
      bytesReceived: file.bytesReceived,
      version: file.version,
      mimeType: file.mimeType,
      finishedAt: file.finishedAt,
      extension: file.extension,
      category: file.category,
      kind: file.kind,
    });
    if (this.recorder) {
      safeRecord(
        this.recorder,
        {
          type: "transfer_finished",
          at: new Date(),
          id: file.id,
          status: state,
          size: bytes,
        },
        this.log,
      );
    }
  }

  startTransfer(
    session: Session, transferId: string, owner: string, sender: Participant, metadata: TransferMetadata,
  ): TransferCheckpoint {
    this.requireActiveUploadSession(session);
    let transfers = this.transfers.get(session);
    const existing = transfers?.get(transferId);
    if (existing) {
      if (existing.owner !== owner) throw transferError(404, "Transfer not found");
      const previous = existing.metadata;
      if (previous.name !== metadata.name || previous.size !== metadata.size ||
          previous.mimeType !== metadata.mimeType || previous.originalSize !== metadata.originalSize) {
        throw transferError(409, "Transfer metadata has changed");
      }
      if (existing.file.state === "receiving" && !existing.writing) this.armExpiry(session.id, transferId, existing);
      return this.checkpoint(existing);
    }
    if (session.state !== "PAIRED" && session.state !== "TRANSFERRING") {
      throw transferError(409, "Session is not ready for uploads");
    }
    if (metadata.size > this.config.maxFileSize) throw transferError(413, "File too large");
    if (!transfers) {
      transfers = new Map();
      this.transfers.set(session, transfers);
    }
    if (transfers.size >= MAX_TRANSFERS_PER_SESSION) throw transferError(413, "Transfer limit exceeded");
    const file = this.beginFileUpload(session, metadata.name, metadata.mimeType, metadata.size,
      metadata.originalSize, undefined, sender);
    const transfer: ResumableTransfer = { owner, metadata, file, offset: 0, writing: false };
    transfers.set(transferId, transfer);
    this.armExpiry(session.id, transferId, transfer);
    return this.checkpoint(transfer);
  }

  async appendTransfer(
    session: Session, transferId: string, owner: string, offset: number, stream: Readable,
    signal: AbortSignal,
  ): Promise<TransferCheckpoint> {
    this.requireActiveUploadSession(session);
    const transfer = this.transfers.get(session)?.get(transferId);
    if (!transfer || transfer.owner !== owner) throw transferError(404, "Transfer not found");
    if (transfer.file.state !== "receiving") return this.checkpoint(transfer);
    if ((session.state !== "PAIRED" && session.state !== "TRANSFERRING") ||
        transfer.writing || offset !== transfer.offset) {
      throw transferError(409, "Transfer is busy or offset is no longer current");
    }

    const { file } = transfer;
    const path = this.getFilePath(session.id, file.storageName);
    const length = Math.min(RESUMABLE_UPLOAD_CHUNK_BYTES, transfer.metadata.size - offset);
    transfer.writing = true;
    this.clearExpiry(transfer);
    let reservation: StorageReservation | undefined;
    let writerOpened = false;
    try {
      reservation = await this.reserveStorage(session.id);
      this.requireActiveUploadSession(session);
      if (signal.aborted) throw uploadAborted();
      const writer = createWriteStream(path, { flags: offset === 0 ? "w" : "r+", start: offset });
      writerOpened = true;
      await this.pipeToFile(stream, writer, reservation, file, signal, { offset, length });
      this.requireActiveUploadSession(session);
      if (signal.aborted) throw uploadAborted();

      transfer.offset += length;
      file.bytesReceived = transfer.offset;
      this.reservations.delete(reservation);
      if (transfer.offset === transfer.metadata.size) {
        this.partialBytes.delete(file);
        this.finishFileUpload(session, file, "completed", transfer.offset);
        if (session.mode === "twoway") {
          const event = itemAddedEvent(file);
          if (event) this.repository.notifyWs(session.id, event);
        }
      } else {
        this.partialBytes.set(file, transfer.offset);
        fileEvents.markProgress(session.id, file);
      }
      return this.checkpoint(transfer);
    } catch (error) {
      if (writerOpened && this.repository.getById(session.id) === session) {
        try {
          if (offset === 0) await rm(path, { force: true });
          else await truncate(path, offset);
        } catch (rollbackError) {
          // Retain quota for bytes that may still exist until expiry can remove the file.
          this.partialBytes.set(file, offset + (reservation?.bytes ?? 0));
          this.finishFileUpload(session, file, "failed", transfer.offset);
          this.log.warn(`resumable transfer rollback failed: ${session.id} (${(rollbackError as NodeJS.ErrnoException).code})`);
        }
      }
      throw storageError(error);
    } finally {
      if (reservation) this.reservations.delete(reservation);
      transfer.writing = false;
      if (file.state !== "completed" && this.repository.getById(session.id) === session) {
        this.armExpiry(session.id, transferId, transfer);
      }
    }
  }

  private checkpoint(transfer: ResumableTransfer): TransferCheckpoint {
    if (transfer.file.state === "failed") throw transferError(409, "Transfer cannot be resumed");
    return {
      offset: transfer.offset,
      fileId: transfer.file.state === "completed" ? transfer.file.id : null,
      chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES,
    };
  }

  private clearExpiry(transfer: ResumableTransfer): void {
    if (transfer.timer === undefined) return;
    clearTimeout(transfer.timer);
    this.expiryTimers.delete(transfer.timer);
    transfer.timer = undefined;
  }

  private armExpiry(sessionId: string, transferId: string, transfer: ResumableTransfer): void {
    this.clearExpiry(transfer);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(timer);
      void this.expireTransfer(sessionId, transferId);
    }, PARTIAL_TRANSFER_TTL_MS);
    transfer.timer = timer;
    this.expiryTimers.add(timer);
    timer.unref();
  }

  private async expireTransfer(sessionId: string, transferId: string): Promise<void> {
    const session = this.repository.getById(sessionId);
    if (!session || session.state === "CLOSED") return;
    const transfers = this.transfers.get(session);
    const transfer = transfers?.get(transferId);
    if (!transfer || transfer.writing || transfer.file.state === "completed") return;
    transfer.writing = true;
    try {
      await rm(this.getFilePath(sessionId, transfer.file.storageName), { force: true });
      if (this.repository.getById(sessionId) !== session) return;
      this.partialBytes.delete(transfer.file);
      if (transfer.file.state !== "failed") this.finishFileUpload(session, transfer.file, "failed", transfer.offset);
      session.files = session.files.filter((file) => file !== transfer.file);
      transfers?.delete(transferId);
    } catch (error) {
      this.log.warn(`partial upload cleanup failed: ${sessionId} (${(error as NodeJS.ErrnoException).code})`);
      this.armExpiry(session.id, transferId, transfer);
    } finally {
      transfer.writing = false;
    }
  }

  shutdown(): void {
    this.stopListeningForClose();
    for (const timer of this.expiryTimers) clearTimeout(timer);
    this.expiryTimers.clear();
  }

  private storedBytes(session: Session): number {
    return session.files.reduce((sum, file) => sum +
      (file.state === "completed" ? file.size : this.partialBytes.get(file) ?? 0), 0);
  }

  async withItemPublication<T>(
    sessionId: string,
    fileId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${sessionId}/${fileId}`;
    const previous = this.itemPublications.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.itemPublications.set(key, current);
    try {
      await previous;
      return await operation();
    } finally {
      release();
      if (this.itemPublications.get(key) === current) this.itemPublications.delete(key);
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
    originalSize?: number | null,
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

    const expectedVersion = fileRecord.version;
    const finalPath = this.getFilePath(sessionId, fileRecord.storageName);
    // Unique per request: two concurrent replaces must not share a temp file.
    const tempPath = `${finalPath}.${generateStorageName()}.tmp`;
    const tempRecord: SessionFile = {
      ...fileRecord,
      size: 0,
      bytesReceived: 0,
      extension: nextExtension,
    };

    let reservation: StorageReservation | undefined;
    try {
      reservation = await this.reserveStorage(sessionId);
      const writeStream = createWriteStream(tempPath);
      await this.pipeToFile(stream, writeStream, reservation, tempRecord, signal);

      const fileStat = await stat(tempPath);
      return await this.withItemPublication(sessionId, fileId, async () => {
        const currentSession = this.repository.getById(sessionId);
        if (!currentSession || currentSession.state === "CLOSED") {
          throw Object.assign(new Error("Session closed during upload"), { statusCode: 410 });
        }

        if (signal?.aborted) throw uploadAborted();
        const currentFile = currentSession.files.find((file) => file.id === fileId);
        if (!currentFile || currentFile.state !== "completed") {
          throw Object.assign(new Error("File not found"), { statusCode: 404 });
        }
        if (currentFile !== fileRecord || currentFile.version !== expectedVersion) {
          throw Object.assign(new Error("File changed during upload"), { statusCode: 409 });
        }
        await rename(tempPath, finalPath);

        fileRecord.originalName = finalName;
        fileRecord.mimeType = nextMimeType;
        fileRecord.size = fileStat.size;
        if (reservation) this.reservations.delete(reservation);
        fileRecord.bytesReceived = fileStat.size;
        fileRecord.finishedAt = new Date().toISOString();
        fileRecord.version += 1;
        fileRecord.originalSize = originalSize ?? null;
        if (nextExtension) fileRecord.extension = nextExtension;
        fileRecord.category = categorize(fileRecord.extension, fileRecord.mimeType);
        this.repository.update(currentSession);

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
              originalSize: fileRecord.originalSize,
            },
            this.log,
          );
        }

        return { file: fileRecord };
      });
    } catch (err) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw storageError(err);
    } finally {
      if (reservation) this.reservations.delete(reservation);
    }
  }

  private async reserveStorage(sessionId: string): Promise<StorageReservation> {
    let volumeLimit = this.config.maxStorageBytes;
    if (volumeLimit === undefined) {
      const volume = await statfs(this.config.tempDir);
      volumeLimit = volume.blocks * volume.bsize;
    }
    const reservation = { sessionId, bytes: 0, volumeLimit };
    this.reservations.add(reservation);
    return reservation;
  }

  private growReservation(reservation: StorageReservation, bytes: number): void {
    const room = this.repository.getById(reservation.sessionId);
    let roomPending = bytes;
    let volumePending = bytes;
    for (const pending of this.reservations) {
      if (pending === reservation) continue;
      volumePending += pending.bytes;
      if (pending.sessionId === reservation.sessionId) roomPending += pending.bytes;
    }

    if (room?.mode === "twoway") {
      const roomLimit = this.config.twowayMaxTotalBytes ?? TWOWAY_DEFAULTS.maxTotalBytes;
      if (this.storedBytes(room) + roomPending > roomLimit) {
        throw Object.assign(new Error("Session storage limit exceeded"), { statusCode: 413 });
      }
    }

    const stored = this.repository.getAll().reduce((sum, session) => sum + this.storedBytes(session), 0);
    if (stored + volumePending > reservation.volumeLimit) {
      throw Object.assign(new Error("Insufficient storage space"), { statusCode: 507 });
    }
    reservation.bytes = bytes;
  }

  // Streams to disk with the same abort/size/progress rules for upload and replace.
  private pipeToFile(
    stream: Readable,
    ws: WriteStream,
    reservation: StorageReservation,
    fileRecord: SessionFile,
    signal?: AbortSignal,
    chunkRange?: { offset: number; length: number },
  ): Promise<void> {
    const { sessionId } = reservation;
    return new Promise<void>((resolve, reject) => {
      const offset = chunkRange?.offset ?? 0;
      let bytesReceived = offset;
      let failure: Error | undefined;

      const cleanup = () => {
        stream.off("data", onData).off("end", onEnd).off("error", fail).off("close", onInputClose);
        ws.off("error", fail).off("drain", onDrain).off("close", onOutputClose);
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (err: Error) => {
        const disconnected = (err as NodeJS.ErrnoException).code === "ECONNRESET" && !stream.readableEnded;
        failure ??= disconnected ? uploadAborted() : err;
        stream.destroy();
        ws.destroy();
      };
      const onAbort = () => fail(uploadAborted());
      const onInputClose = () => {
        if (!stream.readableEnded) onAbort();
      };
      const onOutputClose = () => {
        cleanup();
        if (failure) reject(failure);
        else if (ws.writableFinished) resolve();
        else {
          stream.destroy();
          reject(uploadAborted());
        }
      };
      const onDrain = () => stream.resume();
      const onData = (chunk: Buffer) => {
        bytesReceived += chunk.length;

        try {
          checkFileSize(stream, bytesReceived, this.config.maxFileSize);
          if (chunkRange && bytesReceived - offset > chunkRange.length) {
            throw transferError(413, "Chunk exceeds its expected length");
          }
          this.growReservation(reservation, bytesReceived - offset);
        } catch (err) {
          fail(err as Error);
          return;
        }

        if (!chunkRange) {
          fileRecord.bytesReceived = bytesReceived;
          if (fileRecord.state === "receiving") fileEvents.markProgress(sessionId, fileRecord);
        }

        if (!ws.write(chunk)) {
          stream.pause();
          ws.once("drain", onDrain);
        }
      };
      const onEnd = () => {
        try {
          checkFileSize(stream, bytesReceived, this.config.maxFileSize);
          if (chunkRange && bytesReceived - offset !== chunkRange.length) {
            throw transferError(400, "Incomplete chunk");
          }
          ws.end();
        } catch (err) {
          fail(err as Error);
        }
      };

      ws.on("error", fail).once("close", onOutputClose);
      stream.on("error", fail).once("close", onInputClose).once("end", onEnd);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted || stream.destroyed) onAbort();
      else stream.on("data", onData);
    });
  }

  getFilePath(sessionId: string, fileId: string): string {
    return join(this.config.tempDir, sessionId, fileId);
  }
}
