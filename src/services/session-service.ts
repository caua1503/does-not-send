import type { Config } from "../utils/config.js";
import type { Session } from "../types.js";
import type { SessionStore } from "../session/store.js";
import { generateSessionId } from "../utils/crypto.js";
import { generateSecret } from "../session/auth.js";
import { generateVisualId } from "../session/visual-id.js";
import { hashToken, consumePairing, type PairingResult } from "../session/pairing.js";
import { PairingError } from "../session/errors.js";
import { transition } from "../session/states.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../session/clock.js";
import { SystemClock } from "../session/clock.js";

export interface SessionWithSecrets extends Session {
  rawComputerToken: string;
  rawQrToken: string;
}

export class SessionService {
  private clock: Clock;

  constructor(
    private store: SessionStore,
    private config: Config,
    clock?: Clock,
  ) {
    this.clock = clock ?? store.clock ?? new SystemClock();
  }

  async create(): Promise<SessionWithSecrets> {
    const rawComputerToken = generateSecret();
    const rawQrToken = generateSecret();
    const activeVisualIds = this.store.getActiveVisualIds();
    const visualId = generateVisualId(activeVisualIds);

    const now = this.clock.now();
    const session: Session = {
      id: generateSessionId(),
      computerTokenHash: hashToken(rawComputerToken),
      phoneCredentialHash: null,
      visualId,
      shortId: visualId,
      qrTokenHash: hashToken(rawQrToken),
      state: "WAITING",
      activeUploads: 0,
      createdAt: new Date(now).toISOString(),
      lastActivity: new Date(now).toISOString(),
      files: [],
      lastSeen: {
        computer: now,
        phone: null,
      },
      closedReason: null,
    };

    this.store.create(session);

    // Create session directory
    const dir = join(this.config.tempDir, session.id);
    await mkdir(dir, { recursive: true });

    return {
      ...session,
      rawComputerToken,
      rawQrToken,
    };
  }

  pair(id: string, qrToken: string): PairingResult {
    const session = this.store.getById(id);
    if (!session) {
      return { ok: false, error: new PairingError("NOT_FOUND") };
    }

    const result = consumePairing(session, qrToken);
    if (result.ok) {
      const now = this.clock.now();
      if (!session.lastSeen) {
        session.lastSeen = { computer: null, phone: null };
      }
      session.lastSeen.phone = now;
      this.store.update(session);
      this.touchActivity(id);
    }
    return result;
  }

  /**
   * Manual login: session id + numeric code in place of reading the QR Code.
   * Any failure is reported as one opaque false, never why. Wrong codes feed
   * the per-session counter; hitting it rotates the code for the computer.
   */
  joinByCode(rawSessionId: string, code: string): { sessionId: string; phoneCredential: string } | null {
    const session = this.store.getByNormalizedVisualId(rawSessionId);
    if (
      !session ||
      session.state === "CLOSED" ||
      !/^\d{6}$/.test(code) ||
      !this.store.loginCodes.consume(session.id, code)
    ) {
      if (session && session.state !== "CLOSED") {
        this.store.loginGuard.recordSessionFailure(session.id, (id) =>
          this.store.loginCodes.issue(id),
        );
      }
      return null;
    }

    this.store.loginGuard.recordSessionSuccess(session.id);

    const phoneCredential = generateSecret();
    session.phoneCredentialHash = hashToken(phoneCredential);
    session.pairedAt = new Date(this.clock.now()).toISOString();
    if (session.state === "WAITING") {
      transition(session, "PAIRED");
    }
    if (!session.lastSeen) {
      session.lastSeen = { computer: null, phone: null };
    }
    session.lastSeen.phone = this.clock.now();
    this.store.update(session);
    this.touchActivity(session.id);

    // Discard the used code and hand the computer the next one right away
    this.store.loginCodes.issue(session.id);
    return { sessionId: session.id, phoneCredential };
  }

  getById(id: string): Session | undefined {
    return this.store.getById(id);
  }

  heartbeat(id: string, role: "computer" | "phone" = "computer"): boolean {
    return this.store.recordHeartbeat(id, role);
  }

  touchActivity(id: string): void {
    const session = this.store.getById(id);
    if (!session || session.state === "CLOSED") return;

    session.lastActivity = new Date(this.clock.now()).toISOString();
    this.store.update(session);
  }

  async tick(): Promise<void> {
    await this.store.tick();
  }
}
