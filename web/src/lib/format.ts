/**
 * Pure formatting utilities.
 * No side effects, no DOM, safe to test in any environment.
 */

const fmtFrac = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * Format bytes to human-readable string in pt-BR locale.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${fmtInt.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmtFrac.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmtFrac.format(bytes / (1024 * 1024))} MB`;
  return `${fmtFrac.format(bytes / (1024 * 1024 * 1024))} GB`;
}

export type FileCategory = "image" | "video" | "audio" | "pdf" | "other";

/**
 * Classify file by mimeType (primary) or extension (fallback).
 */
export function fileCategory(mimeType: string, fileName: string): FileCategory {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  // Extension fallback
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico"].includes(ext)) return "image";
  if (["mp4", "webm", "ogg", "mov", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "aac", "opus", "oga"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "other";
}

export type FileState = "receiving" | "completed" | "failed";

interface FileForProgress {
  size: number;
  bytesReceived: number;
  state: FileState;
}

/**
 * Overall progress across all files (0–1).
 * Files with size=0 are counted as complete.
 */
export function overallProgress(files: FileForProgress[]): number {
  if (files.length === 0) return 0;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes === 0) return 1;
  const received = files.reduce((sum, f) => sum + f.bytesReceived, 0);
  return received / totalBytes;
}

/**
 * Human-readable label for a file state in pt-BR.
 */
export function fileStateLabel(state: FileState): string {
  switch (state) {
    case "receiving":
      return "Recebendo…";
    case "completed":
      return "Concluído";
    case "failed":
      return "Falhou";
  }
}
