import { randomBytes, randomUUID } from "node:crypto";

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
