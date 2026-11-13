import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Clock } from "./clock.js";

export const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;

export interface LoginCodeMessage {
  type: "login_code";
  sessionId: string;
  code: string;
  expiresInMs: number;
}

/** Tells the computer the code it is showing is gone (used or dropped). */
export interface LoginCodeCleared {
  type: "login_code_cleared";
  sessionId: string;
}

export type LoginCodeEvent = LoginCodeMessage | LoginCodeCleared;

/** Uppercase, no spaces and no hyphens — applied to both sides of the lookup. */
export function normalizeSessionId(id: string): string {
  return id.replace(/[\s-]/g, "").toUpperCase();
}

export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): Buffer {
  return Buffer.from(new Bun.CryptoHasher("sha256").update(code).digest());
}

interface StoredLoginCode {
  hash: Buffer;
  /** Kept only to hand the same code to a computer that reconnects. */
  code: string;
  expiresAt: number;
}

/**
 * Numeric login codes for devices that cannot read the QR Code. Codes are
 * issued on demand, reach the session computer over its WebSocket and die
 * once used or expired. Plaintext is held only until then, so a computer
 * that reconnects can receive the code it missed.
 */
export class LoginCodeManager {
  private codes = new Map<string, StoredLoginCode>();
  /** Any "no match" path compares against this, so misses cost what hits cost. */
  private readonly dummyHash = hashCode(randomUUID());

  constructor(
    private readonly deps: {
      clock: Clock;
      notify: (message: LoginCodeEvent) => void;
    },
  ) {}

  /** Issues and sends a fresh code, replacing any previous one. */
  issue(sessionId: string): void {
    const code = generateLoginCode();
    const expiresAt = this.deps.clock.now() + LOGIN_CODE_TTL_MS;
    this.codes.set(sessionId, { hash: hashCode(code), code, expiresAt });
    this.deps.notify({
      type: "login_code",
      sessionId,
      code,
      expiresInMs: expiresAt - this.deps.clock.now(),
    });
  }

  /** The code still in force for a computer that just connected, if any. */
  current(sessionId: string): LoginCodeMessage | null {
    const stored = this.codes.get(sessionId);
    if (!stored) return null;
    const expiresInMs = stored.expiresAt - this.deps.clock.now();
    if (expiresInMs <= 0) return null;
    return { type: "login_code", sessionId, code: stored.code, expiresInMs };
  }

  /** Single-use: a successful match drops the stored code. */
  consume(sessionId: string, code: string): boolean {
    const stored = this.codes.get(sessionId);
    const expired = !stored || this.deps.clock.now() >= stored.expiresAt;
    const candidate = hashCode(code);

    if (expired) {
      timingSafeEqual(candidate, this.dummyHash);
      if (stored) this.codes.delete(sessionId);
      return false;
    }

    if (!timingSafeEqual(candidate, stored.hash)) {
      return false;
    }

    this.codes.delete(sessionId);
    this.deps.notify({ type: "login_code_cleared", sessionId });
    return true;
  }

  drop(sessionId: string): void {
    this.codes.delete(sessionId);
  }

  /** Drops expired codes. New codes are only issued on demand. */
  tick(): void {
    const now = this.deps.clock.now();
    for (const [sessionId, stored] of this.codes) {
      if (now >= stored.expiresAt) this.codes.delete(sessionId);
    }
  }
}
