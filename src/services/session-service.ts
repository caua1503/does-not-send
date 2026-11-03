import type { Config } from "../utils/config.js";
import type { Session } from "../types.js";
import type { SessionRepository } from "../repositories/session-repository.js";
import { generateSessionId } from "../utils/crypto.js";
import { generateSecret } from "../session/auth.js";
import { generateVisualId } from "../session/visual-id.js";
import { hashToken, consumePairing, type PairingResult } from "../session/pairing.js";
import { PairingError } from "../session/errors.js";
import { transition } from "../session/states.js";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileEvents } from "../utils/events.js";

export interface SessionWithSecrets extends Session {
  rawComputerToken: string;
  rawQrToken: string;
}

export class SessionService {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private repository: SessionRepository,
    private config: Config,
  ) {}

  async create(): Promise<SessionWithSecrets> {
    const rawComputerToken = generateSecret();
    const rawQrToken = generateSecret();
    const activeVisualIds = this.repository.getActiveVisualIds();
    const visualId = generateVisualId(activeVisualIds);

    const session: Session = {
      id: generateSessionId(),
      computerTokenHash: hashToken(rawComputerToken),
      phoneCredentialHash: null,
      visualId,
      shortId: visualId,
      qrTokenHash: hashToken(rawQrToken),
      qrConsumedAt: null,
      isPaired: false,
      state: "WAITING",
      activeUploads: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      files: [],
    };

    this.repository.create(session);

    // Create session directory
    const dir = join(this.config.tempDir, session.id);
    await mkdir(dir, { recursive: true });

    // Start inactivity timer
    this.resetTimer(session.id);

    return {
      ...session,
      rawComputerToken,
      rawQrToken,
    };
  }

  pair(id: string, qrToken: string): PairingResult {
    const session = this.repository.getById(id);
    if (!session) {
      return { ok: false, error: new PairingError("NOT_FOUND") };
    }

    const result = consumePairing(session, qrToken);
    if (result.ok) {
      session.isPaired = true;
      this.repository.update(session);
      this.touchActivity(id);
    }
    return result;
  }

  getById(id: string): Session | undefined {
    return this.repository.getById(id);
  }

  async close(id: string): Promise<void> {
    const session = this.repository.getById(id);
    if (!session || session.state === "CLOSED") return;

    transition(session, "CLOSED");
    this.repository.update(session);

    this.clearTimer(id);
    fileEvents.emitSessionClosed(id);
    await this.cleanSessionDir(id);
  }

  heartbeat(id: string): boolean {
    const session = this.repository.getById(id);
    if (!session || session.state === "CLOSED") return false;

    session.lastActivity = new Date().toISOString();
    this.repository.update(session);
    this.resetTimer(id);
    return true;
  }

  touchActivity(id: string): void {
    const session = this.repository.getById(id);
    if (!session || session.state === "CLOSED") return;

    session.lastActivity = new Date().toISOString();
    this.repository.update(session);
    this.resetTimer(id);
  }

  private resetTimer(id: string): void {
    this.clearTimer(id);
    const timer = setTimeout(() => {
      void this.expire(id);
    }, this.config.sessionIdleTimeout);

    // Unref so timer doesn't prevent process exit
    if (timer.unref) timer.unref();

    this.timers.set(id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private async expire(id: string): Promise<void> {
    const session = this.repository.getById(id);
    if (!session || session.state === "CLOSED") return;

    transition(session, "CLOSED");
    this.repository.update(session);
    this.clearTimer(id);
    fileEvents.emitSessionClosed(id);
    await this.cleanSessionDir(id);
  }

  private async cleanSessionDir(id: string): Promise<void> {
    const dir = join(this.config.tempDir, id);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Directory may already be gone
    }
  }

  /** Clear all timers — call on shutdown */
  clearAllTimers(): void {
    for (const [id] of this.timers) {
      this.clearTimer(id);
    }
  }
}
