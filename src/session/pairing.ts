import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionState } from "./states.js";
import { transition } from "./states.js";
import { PairingError } from "./errors.js";

export interface PairableSession {
  id: string;
  state: SessionState;
  qrTokenHash: string | null;
  qrConsumedAt: string | null;
  pairedAt?: string | null;
  phoneCredentialHash?: string | null;
}

export type PairingResult =
  | { ok: true; pairedAt: string; phoneCredential: string }
  | { ok: false; error: PairingError };

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateQrToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Synchronously and atomically consumes a pairing QR token for a session.
 * Since the runtime is single-threaded, keeping this function strictly
 * synchronous with zero await ensures race-free atomic consumption.
 */
export function consumePairing(
  session: PairableSession | undefined | null,
  rawToken: string,
): PairingResult {
  if (!session) {
    return { ok: false, error: new PairingError("NOT_FOUND") };
  }

  if (session.state === "CLOSED") {
    return { ok: false, error: new PairingError("CLOSED") };
  }

  if (session.qrConsumedAt !== null || session.state !== "WAITING") {
    return { ok: false, error: new PairingError("ALREADY_CONSUMED") };
  }

  if (!session.qrTokenHash) {
    return { ok: false, error: new PairingError("INVALID") };
  }

  const computedHash = hashToken(rawToken);
  const computedBuf = Buffer.from(computedHash, "utf-8");
  const storedBuf = Buffer.from(session.qrTokenHash, "utf-8");

  if (
    computedBuf.length !== storedBuf.length ||
    !timingSafeEqual(computedBuf, storedBuf)
  ) {
    return { ok: false, error: new PairingError("INVALID") };
  }

  const rawPhoneCredential = randomBytes(32).toString("base64url");
  session.phoneCredentialHash = hashToken(rawPhoneCredential);

  const now = new Date().toISOString();
  session.qrConsumedAt = now;
  transition(session, "PAIRED");
  session.pairedAt = now;

  return { ok: true, pairedAt: now, phoneCredential: rawPhoneCredential };
}
