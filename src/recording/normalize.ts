import type { categoryEnum } from "../db/schema.js";

type Category = (typeof categoryEnum.enumValues)[number];

const EXTENSION_TO_CATEGORY: Record<string, Category> = {
  // images
  jpg: "images",
  jpeg: "images",
  png: "images",
  gif: "images",
  webp: "images",
  heic: "images",
  heif: "images",
  svg: "images",
  bmp: "images",
  ico: "images",
  // videos
  mp4: "videos",
  mov: "videos",
  avi: "videos",
  mkv: "videos",
  webm: "videos",
  m4v: "videos",
  flv: "videos",
  wmv: "videos",
  // audios
  mp3: "audios",
  wav: "audios",
  flac: "audios",
  aac: "audios",
  ogg: "audios",
  m4a: "audios",
  wma: "audios",
  opus: "audios",
  // pdfs
  pdf: "pdfs",
  // documents
  doc: "documents",
  docx: "documents",
  xls: "documents",
  xlsx: "documents",
  ppt: "documents",
  pptx: "documents",
  txt: "documents",
  rtf: "documents",
  odt: "documents",
  ods: "documents",
  odp: "documents",
  csv: "documents",
  // archives
  zip: "archives",
  rar: "archives",
  "7z": "archives",
  tar: "archives",
  gz: "archives",
  bz2: "archives",
  xz: "archives",
};

const MIME_PREFIX_TO_CATEGORY: Record<string, Category> = {
  "image/": "images",
  "video/": "videos",
  "audio/": "audios",
  "application/pdf": "pdfs",
};

/**
 * Normalize an IP address: remove ::ffff: prefix, lowercase, return null if empty/undefined.
 */
export function normalizeIp(ip?: string): string | null {
  if (!ip || ip.trim() === "") return null;
  const cleaned = ip.toLowerCase().replace(/^::ffff:/i, "");
  return cleaned || null;
}

/**
 * Extract file extension from filename: lowercase, no dot, empty string if none.
 */
export function extractExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

/**
 * Categorize a file by extension first, fallback to MIME type, default to "other".
 * Extension wins over MIME.
 */
export function categorize(extension: string, mime: string): Category {
  // Extension-based lookup (extension already lowercase from extractExtension)
  const extCategory = EXTENSION_TO_CATEGORY[extension];
  if (extCategory) return extCategory;

  // MIME-based fallback
  const mimeLower = mime.toLowerCase();
  for (const [prefix, category] of Object.entries(MIME_PREFIX_TO_CATEGORY)) {
    if (mimeLower.startsWith(prefix)) return category;
  }

  return "other";
}
