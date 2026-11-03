import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionState } from "./states.js";
import { transition } from "./states.js";
import { hashToken } from "./pairing.js";

export type SessionRole = "computer" | "phone";

export interface AuthorizableSession {
  id: string;
  state: SessionState;
  computerTokenHash: string;
  phoneCredentialHash: string | null;
  activeUploads?: number;
}

export type AuthResult =
  | { ok: true; session: AuthorizableSession }
  | { ok: false; reason: "INVALID" | "CLOSED" | "NOT_FOUND" };

/**
 * Generates a high-entropy secret using randomBytes(32).toString('base64url').
 */
export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function verifyHash(candidateSecret: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidateHash = hashToken(candidateSecret);
  const candBuf = Buffer.from(candidateHash, "utf-8");
  const storedBuf = Buffer.from(storedHash, "utf-8");

  if (candBuf.length !== storedBuf.length) {
    timingSafeEqual(candBuf, candBuf);
    return false;
  }

  return timingSafeEqual(candBuf, storedBuf);
}

/**
 * Pure domain authorization function for computer and phone roles.
 * All route handlers and WebSocket entry points must call this.
 */
export function authorize(
  session: AuthorizableSession | undefined | null,
  role: SessionRole,
  secret: string,
): AuthResult {
  if (!session) {
    // Constant-time compare against dummy to avoid timing discrepancy
    const dummy = Buffer.alloc(64);
    timingSafeEqual(dummy, dummy);
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (session.state === "CLOSED") {
    return { ok: false, reason: "CLOSED" };
  }

  let valid = false;
  if (role === "computer") {
    valid = verifyHash(secret, session.computerTokenHash);
  } else if (role === "phone") {
    valid = verifyHash(secret, session.phoneCredentialHash);
  }

  if (!valid) {
    return { ok: false, reason: "INVALID" };
  }

  return { ok: true, session };
}

/**
 * Synchronously marks an upload as active.
 * Moves state from PAIRED to TRANSFERRING on first active upload.
 */
export function startUpload(session: AuthorizableSession): void {
  if (session.state !== "PAIRED" && session.state !== "TRANSFERRING") {
    throw new Error(`Invalid state for upload: cannot start upload in state ${session.state}`);
  }

  const currentActive = session.activeUploads ?? 0;
  if (currentActive === 0 && session.state === "PAIRED") {
    transition(session, "TRANSFERRING");
  }

  session.activeUploads = currentActive + 1;
}

/**
 * Synchronously marks an upload as completed.
 * Moves state from TRANSFERRING back to PAIRED when active uploads reaches 0.
 */
export function endUpload(session: AuthorizableSession): void {
  const currentActive = session.activeUploads ?? 0;
  const nextActive = Math.max(0, currentActive - 1);
  session.activeUploads = nextActive;

  if (nextActive === 0 && session.state === "TRANSFERRING") {
    transition(session, "PAIRED");
  }
}
