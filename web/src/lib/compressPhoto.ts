import imageCompression, { type Options } from "browser-image-compression";

/**
 * 1.2 MB threshold in bytes (1.2 * 1024 * 1024 = 1,258,291.2 bytes).
 * Only images strictly larger than this threshold are compressed.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1.2 * 1024 * 1024;

/**
 * Simple concurrency queue to limit parallel tasks (e.g. at most 2 photo compressions).
 */
export class CompressionQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/** Global default queue for client photo compression (max 2 parallel). */
export const defaultCompressionQueue = new CompressionQueue(2);

/**
 * Check whether a file qualifies for client-side compression:
 * - Must be an image (MIME starting with 'image/')
 * - Size must be strictly greater than 1.2 MB
 */
export function isCompressiblePhoto(file: File): boolean {
  if (!file.type || !file.type.startsWith("image/")) {
    return false;
  }
  return file.size > COMPRESSION_THRESHOLD_BYTES;
}

export interface CompressPhotoOptions {
  queue?: CompressionQueue;
  timeoutMs?: number;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  initialQuality?: number;
  useWebWorker?: boolean;
  preserveExif?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Compresses a photo in the browser before upload.
 *
 * Rules:
 * - Only compresses if file is an image and > 1.2 MB.
 * - Options: maxSizeMB 1, maxWidthOrHeight 2560, initialQuality 0.85, useWebWorker true, fileType = file.type, preserveExif false.
 * - If result is not smaller or MIME type changes, returns original file.
 * - If compression fails or times out, returns original file.
 * - Runs through a queue with at most 2 concurrent compressions.
 */
export async function compressPhoto(
  file: File,
  options?: CompressPhotoOptions
): Promise<File> {
  // 1. Files that are not images or <= 1.2 MB pass straight through
  if (!isCompressiblePhoto(file)) {
    return file;
  }

  const queue = options?.queue ?? defaultCompressionQueue;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return queue.run(async () => {
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const compressionOptions: Options = {
        maxSizeMB: options?.maxSizeMB ?? 1,
        maxWidthOrHeight: options?.maxWidthOrHeight ?? 2560,
        initialQuality: options?.initialQuality ?? 0.85,
        useWebWorker: options?.useWebWorker ?? true,
        fileType: file.type,
        preserveExif: options?.preserveExif ?? false,
        signal: controller.signal,
      };

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          controller.abort(new Error("Compression timeout"));
          reject(new Error("Compression timeout"));
        }, timeoutMs);
      });

      const compressed = await Promise.race([
        imageCompression(file, compressionOptions),
        timeoutPromise,
      ]);

      // 2. Never return larger or equal: must be strictly smaller and same MIME type
      if (compressed.size >= file.size || compressed.type !== file.type) {
        return file;
      }

      // Ensure original filename is preserved if the library renamed it
      if (compressed.name !== file.name) {
        return new File([compressed], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        });
      }

      return compressed;
    } catch {
      // 3. On failure or timeout: return original file and keep workflow going
      return file;
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
    }
  });
}
