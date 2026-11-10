import { randomUUID } from "node:crypto";

/** Generate random session ID */
export function generateSessionId(): string {
  return randomUUID();
}

/** Generate random file storage name */
export function generateStorageName(): string {
  return randomUUID();
}
