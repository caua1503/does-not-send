import { timingSafeEqual } from "node:crypto";
import { type Clock } from "../session/clock.js";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_TOKEN_LENGTH = 256;
const TOKEN_BYTES = 32; // 32 random bytes per DECISÕES

function sha256Hex(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/**
 * In-memory admin session store: Map of sha256(token) -> expiry.
 * Restarting the server logs every admin out (accepted trade-off).
 */
export class AdminSessionStore {
  private readonly sessions = new Map<string, number>();
  /** Stand-in digest so expired/unknown tokens always go through a timingSafeEqual. */
  private readonly dummyHash = sha256Hex(crypto.randomUUID());
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(private readonly clock: Clock) {}

  startSweeper(): void {
    if (this.sweeper) return;
    const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    timer.unref?.();
    this.sweeper = timer;
  }

  stop(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
  }

  /** Creates a token; only its sha256 half (plus expiry) is kept in memory. */
  issue(now = this.clock.now()): { token: string; expiresAt: Date } {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    const token = Buffer.from(bytes).toString("base64url");
    const expiresAtMs = now.getTime() + SESSION_TTL_MS;
    this.sessions.set(sha256Hex(token), expiresAtMs);
    this.sweep(now);
    return { token, expiresAt: new Date(expiresAtMs) };
  }

  /** Constant-shape check: hits and misses both end in a timingSafeEqual. */
  lookup(token: string | undefined, now = this.clock.now()): Date | null {
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      constantCompare(this.dummyHash, this.dummyHash);
      return null;
    }
    const expiryMs = this.sessions.get(sha256Hex(token));
    if (expiryMs === undefined || expiryMs <= now.getTime()) {
      constantCompare(this.dummyHash, this.dummyHash);
      return null;
    }
    return new Date(expiryMs);
  }

  revoke(token: string | undefined): void {
    if (!token || token.length > MAX_TOKEN_LENGTH) return;
    this.sessions.delete(sha256Hex(token));
  }

  /** Removes expired entries; hourly via unref'd interval, plus opportunistically. */
  sweep(now = this.clock.now()): void {
    const ts = now.getTime();
    for (const [hash, expiresAt] of this.sessions) {
      if (expiresAt <= ts) this.sessions.delete(hash);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}

function constantCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function safeStringEqual(a: string, b: string): boolean {
  return constantCompare(sha256Hex(a), sha256Hex(b));
}
