/**
 * Funções Puras de Transformação
 * 
 * normalizeIp: remove prefixo ::ffff: de endereços IPv4-mapped
 * parseUserAgent: extrai só família do navegador e SO via regex simples
 * categorize: categoriza arquivo por extensão (prioridade) ou MIME
 * sanitizeFileName: basename, remove controles, trunca 255
 */

const BROWSER_PATTERNS = [
  { pattern: /Edg(?:e|A)?\/(\d+)/, name: "Edge" },
  { pattern: /Chrome\/(\d+)/, name: "Chrome" },
  { pattern: /Safari\/(\d+)/, name: "Safari" },
  { pattern: /Firefox\/(\d+)/, name: "Firefox" },
  { pattern: /Opera\/(\d+)|OPR\/(\d+)/, name: "Opera" },
];

const OS_PATTERNS = [
  { pattern: /Android\s+([\d.]+)/, name: "Android" },
  { pattern: /iPhone OS ([\d_]+)/, name: "iOS" },
  { pattern: /Windows NT ([\d.]+)/, name: "Windows" },
  { pattern: /Mac OS X ([\d_]+)/, name: "macOS" },
  { pattern: /Linux/, name: "Linux" },
];

const CATEGORY_BY_EXT: Record<string, string> = {
  jpg: "images",
  jpeg: "images",
  png: "images",
  gif: "images",
  webp: "images",
  svg: "images",
  heic: "images",
  mp4: "videos",
  mov: "videos",
  avi: "videos",
  mkv: "videos",
  webm: "videos",
  mp3: "audios",
  wav: "audios",
  flac: "audios",
  ogg: "audios",
  m4a: "audios",
  pdf: "pdfs",
  doc: "documents",
  docx: "documents",
  xls: "documents",
  xlsx: "documents",
  ppt: "documents",
  pptx: "documents",
  txt: "documents",
  csv: "documents",
  zip: "archives",
  rar: "archives",
  "7z": "archives",
  tar: "archives",
  gz: "archives",
};

const CATEGORY_BY_MIME: Record<string, string> = {
  "image/": "images",
  "video/": "videos",
  "audio/": "audios",
  "application/pdf": "pdfs",
  "application/vnd.openxmlformats": "documents",
  "application/vnd.ms-": "documents",
  "application/msword": "documents",
  "text/plain": "documents",
  "application/zip": "archives",
  "application/x-rar": "archives",
  "application/x-7z": "archives",
  "application/x-tar": "archives",
  "application/gzip": "archives",
};

/**
 * Remove prefixo ::ffff: de endereços IPv4-mapped-IPv6
 */
export function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, "");
}

/**
 * Extrai família do navegador e do SO via regex simples
 * Retorna "BrowserName (OS)" ou "Unknown" se não detectar
 */
export function parseUserAgent(ua: string): string {
  let browser = "Unknown";
  let os = "Unknown";

  for (const { pattern, name } of BROWSER_PATTERNS) {
    if (pattern.test(ua)) {
      browser = name;
      break;
    }
  }

  for (const { pattern, name } of OS_PATTERNS) {
    if (pattern.test(ua)) {
      os = name;
      break;
    }
  }

  if (browser === "Unknown" && os === "Unknown") return "Unknown";
  return `${browser} (${os})`;
}

/**
 * Categoriza arquivo por extensão (prioridade) ou MIME (fallback)
 * Retorna images|videos|audios|pdfs|documents|archives|other
 */
export function categorize(extension: string, mime: string): string {
  const extLower = extension.toLowerCase();

  // Prioridade: extensão
  if (CATEGORY_BY_EXT[extLower]) {
    return CATEGORY_BY_EXT[extLower];
  }

  // Fallback: MIME
  for (const [prefix, category] of Object.entries(CATEGORY_BY_MIME)) {
    if (mime.startsWith(prefix)) {
      return category;
    }
  }

  return "other";
}

/**
 * Sanitize filename: basename, remove controles, trunca 255
 */
export function sanitizeFileName(name: string): string {
  // Basename: pegar última parte após / ou \
  const parts = name.split(/[/\\]/);
  let base = parts[parts.length - 1] || "";

  // Remover caracteres de controle (U+0000 a U+001F, U+007F)
  base = base.replace(/[\x00-\x1F\x7F]/g, "");

  // Truncar 255 bytes (assumindo UTF-8, simplificado para 255 chars)
  if (base.length > 255) {
    base = base.slice(0, 255);
  }

  return base;
}
