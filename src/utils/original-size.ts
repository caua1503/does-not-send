/** Client-declared pre-compression size is untrusted: anything beyond 2 GiB
 *  (larger than any upload this server accepts) is treated as missing. */
export const MAX_ORIGINAL_SIZE_BYTES = 2 * 1024 ** 3;

/** Returns null for absent/invalid values so the upload never fails because of it. */
export function parseOriginalSize(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ORIGINAL_SIZE_BYTES) {
    return null;
  }
  return value;
}
