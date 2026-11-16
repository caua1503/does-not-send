import { randomBytes } from "node:crypto";
import type { Clock } from "./clock.js";

export type InviteMode = "single" | "multi";
export type InviteState = "valid" | "expired" | "used" | "revoked";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITE_CODE_LENGTH = 8;
export const INVITE_ATTEMPT_LIMIT = 10;
export const INVITE_ATTEMPT_WINDOW_MS = 60_000;

/** Base32 without ambiguous i, l, o and u (32 symbols). */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export interface Invite {
  code: string;
  sessionId: string;
  mode: InviteMode;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  revoked: boolean;
}

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET.charAt(byte & 31);
  return code;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toLowerCase();
}

/** In-memory invite links. Each one is another door to the session guest token. */
export class InviteManager {
  private invites = new Map<string, Invite>();
  private attempts = new Map<string, number[]>();

  constructor(private readonly deps: { clock: Clock }) {}

  create(sessionId: string, mode: InviteMode): Invite {
    let code = generateInviteCode();
    while (this.invites.has(code)) code = generateInviteCode();

    const now = this.deps.clock.now();
    const invite: Invite = {
      code,
      sessionId,
      mode,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      usedAt: null,
      usedBy: null,
      revoked: false,
    };
    this.invites.set(code, invite);
    return invite;
  }

  get(rawCode: string): Invite | undefined {
    return this.invites.get(normalizeInviteCode(rawCode));
  }

  state(invite: Invite): InviteState {
    if (invite.revoked) return "revoked";
    if (invite.mode === "single" && invite.usedAt !== null) return "used";
    if (this.deps.clock.now() >= invite.expiresAt) return "expired";
    return "valid";
  }

  /** Attempts still inside the window, oldest first. */
  private liveAttempts(code: string): number[] {
    const since = this.deps.clock.now() - INVITE_ATTEMPT_WINDOW_MS;
    const hits = (this.attempts.get(code) ?? []).filter((at) => at > since);
    if (hits.length === 0) this.attempts.delete(code);
    return hits;
  }

  attemptRetryAfterMs(code: string): number {
    const hits = this.liveAttempts(code);
    if (hits.length < INVITE_ATTEMPT_LIMIT) return 0;
    return Math.max(1_000, hits[0]! + INVITE_ATTEMPT_WINDOW_MS - this.deps.clock.now());
  }

  recordAttempt(code: string): void {
    const hits = this.liveAttempts(code);
    hits.push(this.deps.clock.now());
    this.attempts.set(code, hits);
  }

  /**
   * Synchronous check-and-set. A single invite is consumed once; the same
   * device may retry, any other device finds it used.
   */
  consume(invite: Invite, deviceId: string | null): boolean {
    if (invite.mode === "multi") return true;
    if (invite.usedAt !== null) {
      return deviceId !== null && invite.usedBy === deviceId;
    }
    invite.usedAt = this.deps.clock.now();
    invite.usedBy = deviceId;
    return true;
  }

  revoke(sessionId: string, rawCode: string): Invite | undefined {
    const invite = this.get(rawCode);
    if (!invite || invite.sessionId !== sessionId) return undefined;
    invite.revoked = true;
    return invite;
  }

  dropSession(sessionId: string): void {
    for (const [code, invite] of this.invites) {
      if (invite.sessionId !== sessionId) continue;
      this.invites.delete(code);
      this.attempts.delete(code);
    }
  }

  clear(): void {
    this.invites.clear();
    this.attempts.clear();
  }
}
