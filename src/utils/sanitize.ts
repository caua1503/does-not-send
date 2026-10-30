const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Sanitize a filename for display purposes.
 * Blocks path traversal, control characters, reserved names.
 * Returns sanitized name or throws if fundamentally unsafe.
 */
export function sanitizeFilename(name: string): string {
  if (!name || name.length === 0) {
    throw new Error("Empty filename");
  }

  // Reject null bytes
  if (name.includes("\0")) {
    throw new Error("Filename contains null bytes");
  }

  // Reject control characters (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(name)) {
    throw new Error("Filename contains control characters");
  }

  // Take only the basename (remove any path separators)
  const basename = name.split(/[/\\]/).pop() ?? "";

  if (!basename || basename.length === 0) {
    throw new Error("Filename resolves to empty after path removal");
  }

  // Reject path traversal patterns
  if (basename === "." || basename === ".." || basename.startsWith("..")) {
    throw new Error("Path traversal attempt detected");
  }

  // Reject reserved names (Windows)
  const nameWithoutExt = basename.split(".")[0]?.toLowerCase() ?? "";
  if (RESERVED_NAMES.has(nameWithoutExt)) {
    throw new Error("Reserved filename");
  }

  // Truncate extremely long names
  if (basename.length > 255) {
    return basename.slice(0, 255);
  }

  return basename;
}
