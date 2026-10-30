import { randomBytes, randomUUID } from "node:crypto";

/** Unambiguous uppercase alphanumeric charset (excludes 0, 1, I, O) */
const SHORT_ID_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Generate cryptographically random token (at least 128 bits / 16 bytes) */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Generate random session ID */
export function generateSessionId(): string {
  return randomUUID();
}

/** Generate random file storage name */
export function generateStorageName(): string {
  return randomUUID();
}

/** Generate human-readable short session ID (uppercase alphanumeric, no ambiguous chars: 0, 1, I, O) */
export function generateShortId(length = 6): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += SHORT_ID_CHARSET[bytes[i]! % SHORT_ID_CHARSET.length];
  }
  return id;
}
