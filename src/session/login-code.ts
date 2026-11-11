import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Clock } from "./clock.js";

export const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;

export interface LoginCodeMessage {
  type: "login_code";
  sessionId: string;
  code: string;
  expiresInMs: number;
}

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
  expiresAt: number;
}

/**
 * Numeric login codes for devices that cannot read the QR Code. Only the hash
 * and the expiry are kept; the code reaches the session computer over its
 * WebSocket on every issue/rotation, and dies once used or expired.
 */
export class LoginCodeManager {
  private codes = new Map<string, StoredLoginCode>();
  /** Any "no match" path compares against this, so misses cost what hits cost. */
  private readonly dummyHash = hashCode(randomUUID());

  constructor(
    private readonly deps: {
      clock: Clock;
      notify: (message: LoginCodeMessage) => void;
    },
  ) {}

  /** Issues and sends a fresh code, replacing any previous one. */
  issue(sessionId: string): void {
    const code = generateLoginCode();
    this.codes.set(sessionId, {
      hash: hashCode(code),
      expiresAt: this.deps.clock.now() + LOGIN_CODE_TTL_MS,
    });
    this.deps.notify({
      type: "login_code",
      sessionId,
      code,
      expiresInMs: LOGIN_CODE_TTL_MS,
    });
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
    return true;
  }

  drop(sessionId: string): void {
    this.codes.delete(sessionId);
  }

  /** Drops expired codes and issues one for every listed session that lacks one. */
  tick(sessions: Iterable<{ id: string }>): void {
    const now = this.deps.clock.now();
    for (const [sessionId, stored] of this.codes) {
      if (now >= stored.expiresAt) this.codes.delete(sessionId);
    }
    for (const session of sessions) {
      if (!this.codes.has(session.id)) this.issue(session.id);
    }
  }
}
