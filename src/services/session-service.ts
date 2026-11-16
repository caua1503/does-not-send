import type { Config } from "../utils/config.js";
import type { DeviceKind, Session, SessionMode } from "../types.js";
import type { SessionStore } from "../session/store.js";
import { generateSessionId } from "../utils/crypto.js";
import { generateSecret } from "../session/auth.js";
import { generateVisualId } from "../session/visual-id.js";
import { hashToken, consumePairing, type PairingResult } from "../session/pairing.js";
import { PairingError } from "../session/errors.js";
import { transition } from "../session/states.js";
import { createHostParticipant } from "../session/participants.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../session/clock.js";
import { SystemClock } from "../session/clock.js";

export interface SessionWithSecrets extends Session {
  rawHostToken: string;
  rawQrToken: string;
}

export interface CreateSessionInput {
  mode?: SessionMode;
  name?: string;
  device?: DeviceKind;
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

  async create(input: CreateSessionInput = {}): Promise<SessionWithSecrets> {
    const rawHostToken = generateSecret();
    const rawQrToken = generateSecret();
    const activeVisualIds = this.store.getActiveVisualIds();
    const visualId = generateVisualId(activeVisualIds);
    const mode: SessionMode = input.mode === "twoway" ? "twoway" : "oneway";

    const now = this.clock.now();
    const session: Session = {
      id: generateSessionId(),
      hostTokenHash: hashToken(rawHostToken),
      guestCredentialHash: null,
      visualId,
      shortId: visualId,
      qrTokenHash: hashToken(rawQrToken),
      state: mode === "twoway" ? "PAIRED" : "WAITING",
      activeUploads: 0,
      createdAt: new Date(now).toISOString(),
      lastActivity: new Date(now).toISOString(),
      files: [],
      lastSeen: {
        host: now,
        guest: null,
      },
      closedReason: null,
      mode,
    };

    if (mode === "twoway") {
      const host = createHostParticipant(
        input.name,
        input.device,
        new Date(now).toISOString(),
      );
      session.hostId = host.id;
      session.participants = [host];
    }

    this.store.create(session);

    // Create session directory
    const dir = join(this.config.tempDir, session.id);
    await mkdir(dir, { recursive: true });

    return {
      ...session,
      rawHostToken,
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
        session.lastSeen = { host: null, guest: null };
      }
      session.lastSeen.guest = now;
      this.store.update(session);
      this.touchActivity(id);
    }
    return result;
  }

  /**
   * Manual login: session id + numeric code in place of reading the QR Code.
   * Any failure is reported as one opaque false, never why. Wrong codes feed
   * the per-session counter; hitting it rotates the code for the host.
   */
  joinByCode(rawSessionId: string, code: string): { sessionId: string; guestCredential: string } | null {
    const session = this.store.getByNormalizedVisualId(rawSessionId);
    if (
      !session ||
      session.state === "CLOSED" ||
      !/^\d{6}$/.test(code) ||
      !this.store.loginCodes.consume(session.id, code)
    ) {
      if (session && session.state !== "CLOSED") {
        this.store.loginGuard.recordSessionFailure(session.id, (id) => {
          // Rotate only a code that exists; codes are never issued unasked
          if (this.store.loginCodes.current(id)) this.store.loginCodes.issue(id);
        });
      }
      return null;
    }

    this.store.loginGuard.recordSessionSuccess(session.id);

    const guestCredential = generateSecret();
    session.guestCredentialHash = hashToken(guestCredential);
    session.pairedAt = new Date(this.clock.now()).toISOString();
    if (session.state === "WAITING") {
      transition(session, "PAIRED");
    }
    if (!session.lastSeen) {
      session.lastSeen = { host: null, guest: null };
    }
    session.lastSeen.guest = this.clock.now();
    this.store.update(session);
    this.touchActivity(session.id);

    return { sessionId: session.id, guestCredential };
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
