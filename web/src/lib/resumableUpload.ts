import {
  RESUMABLE_UPLOAD_CHUNK_BYTES,
  type TransferCheckpoint,
} from "../../../src/shared/resumable-upload.ts";
import { ApiError } from "./api.ts";

interface ResumableUploadOptions {
  url: string;
  credential: string;
  file: File;
  originalSize: number;
  signal: AbortSignal;
  onProgress: (uploadedBytes: number) => void;
}

// getRandomValues is available on a LAN HTTP origin, where randomUUID may not be.
export function newTransferId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function apiError(status: number, raw: object): ApiError {
  const { error, code } = raw as { error?: unknown; code?: unknown };
  return new ApiError(typeof error === "string" ? error : `Erro ${status}`, status,
    typeof code === "string" ? code : undefined);
}

function checkpoint(raw: unknown, total: number): TransferCheckpoint {
  const value = raw as Partial<TransferCheckpoint> | null;
  if (!value || typeof value.offset !== "number" || !Number.isSafeInteger(value.offset) ||
      value.offset < 0 || value.offset > total ||
      typeof value.chunkSize !== "number" || !Number.isSafeInteger(value.chunkSize) ||
      value.chunkSize < 1 || value.chunkSize > RESUMABLE_UPLOAD_CHUNK_BYTES ||
      (value.offset === total ? typeof value.fileId !== "string" || !value.fileId : value.fileId !== null)) {
    throw new Error("Resposta inválida de retomada");
  }
  return { offset: value.offset, chunkSize: value.chunkSize, fileId: value.fileId ?? null };
}

function sendChunk(options: ResumableUploadOptions, offset: number, end: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const xhr = new XMLHttpRequest();
    function cleanup() {
      signal.removeEventListener("abort", cancel);
    }
    function cancel() {
      cleanup();
      reject(signal.reason);
      xhr.abort?.();
    }
    const networkError = () => {
      cleanup();
      reject(new Error("Sem conexão com o servidor"));
    };
    xhr.onload = () => {
      cleanup();
      let response: object = {};
      try {
        response = JSON.parse(xhr.responseText) ?? {};
      } catch {
        // Validation below handles non-JSON replies.
      }
      if (xhr.status === 200) resolve(response);
      else reject(apiError(xhr.status, response));
    };
    xhr.onerror = xhr.ontimeout = xhr.onabort = networkError;
    xhr.upload.onprogress = ({ loaded }) => {
      if (!signal.aborted) options.onProgress(Math.min(end, offset + loaded));
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      xhr.open("PUT", `${options.url}?offset=${offset}`);
      xhr.timeout = 120_000;
      xhr.setRequestHeader("Authorization", `Bearer ${options.credential}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(options.file.slice(offset, end));
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function resumableUpload(options: ResumableUploadOptions): Promise<string> {
  const { url, credential, file, originalSize, signal, onProgress } = options;
  const start = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size, originalSize }),
    signal,
  });
  const body = await start.json().catch(() => null);
  if (!start.ok) throw apiError(start.status, body ?? {});

  let current = checkpoint(body, file.size);
  onProgress(current.offset);
  while (current.fileId === null) {
    const end = Math.min(file.size, current.offset + current.chunkSize);
    const next = checkpoint(await sendChunk(options, current.offset, end), file.size);
    if (next.offset !== end || next.chunkSize !== current.chunkSize) {
      throw new Error("Offset de retomada inválido");
    }
    current = next;
    onProgress(current.offset);
  }
  return current.fileId;
}
