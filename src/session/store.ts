import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Session, SessionRole } from "../types.js";
import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import { DEFAULT_TIMING_CONFIG, type SessionTimingConfig } from "./timing.js";
import { transition } from "./states.js";
import { authorize as domainAuthorize } from "./auth.js";
import { fileEvents } from "../utils/events.js";

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PendingWs {
  sessionId: string;
  socket: WebSocketLike;
  connectedAt: number;
}

export interface SessionStoreOptions {
  clock?: Clock;
  tempDir: string;
  timingConfig?: Partial<SessionTimingConfig>;
  sessionIdleTimeout?: number;
}

export class SessionStore {
  readonly clock: Clock;
  readonly timingConfig: SessionTimingConfig;
  readonly tempDir: string;
  readonly sessionIdleTimeout?: number;

  private sessions = new Map<string, Session>();
  private pendingSockets = new Set<PendingWs>();
  private activeSockets = new Map<string, { computer?: WebSocketLike; phone?: WebSocketLike }>();
  private activeUploadControllers = new Map<string, Set<AbortController>>();
  private sweeperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionStoreOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.tempDir = options.tempDir;
    this.sessionIdleTimeout = options.sessionIdleTimeout;
    this.timingConfig = {
      ...DEFAULT_TIMING_CONFIG,
      ...options.timingConfig,
    };
  }

  // Repository-compatible methods
  create(session: Session): void {
    if (!session.lastSeen) {
      session.lastSeen = { computer: null, phone: null };
    }
    if (session.phoneLostAt === undefined) session.phoneLostAt = null;
    if (session.computerLostAt === undefined) session.computerLostAt = null;
    if (session.closedReason === undefined) session.closedReason = null;
    this.sessions.set(session.id, session);
  }

  getById(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getByShortId(shortId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.shortId === shortId || session.visualId === shortId) {
        return session;
      }
    }
    return undefined;
  }

  getByVisualId(visualId: string): Session | undefined {
    return this.getByShortId(visualId);
  }

  getActiveVisualIds(): Set<string> {
    const set = new Set<string>();
    for (const session of this.getAllActive()) {
      if (session.visualId) set.add(session.visualId);
      if (session.shortId) set.add(session.shortId);
    }
    return set;
  }

  update(session: Session): void {
    if (!this.sessions.has(session.id)) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  getAllActive(): Session[] {
    return this.getAll().filter((s) => s.state !== "CLOSED");
  }

  getActiveIds(): Set<string> {
    return new Set(this.getAllActive().map((s) => s.id));
  }

  clear(): void {
    this.sessions.clear();
    this.pendingSockets.clear();
    this.activeSockets.clear();
    this.activeUploadControllers.clear();
  }

  // Presence queries
  isPhonePresent(sessionId: string): boolean {
    const session = this.getById(sessionId);
    if (!session || session.lastSeen.phone === null) return false;
    return this.clock.now() - session.lastSeen.phone <= this.timingConfig.heartbeatTimeoutMs;
  }

  isComputerPresent(sessionId: string): boolean {
    const session = this.getById(sessionId);
    if (!session || session.lastSeen.computer === null) return false;
    return this.clock.now() - session.lastSeen.computer <= this.timingConfig.heartbeatTimeoutMs;
  }

  // Heartbeat handler
  recordHeartbeat(sessionId: string, role: "computer" | "phone"): boolean {
    const session = this.getById(sessionId);
    if (!session || session.state === "CLOSED") return false;

    const now = this.clock.now();
    session.lastSeen[role] = now;
    session.lastActivity = new Date(now).toISOString();

    if (role === "phone") {
      if (session.state === "DISCONNECTED") {
        transition(session, "PAIRED");
        session.phoneLostAt = null;
      }
    } else if (role === "computer") {
      if (session.computerLostAt !== null) {
        session.computerLostAt = null;
      }
    }

    this.update(session);
    return true;
  }

  // Upload AbortController registry
  registerUploadAbortController(sessionId: string, controller: AbortController): () => void {
    let set = this.activeUploadControllers.get(sessionId);
    if (!set) {
      set = new Set();
      this.activeUploadControllers.set(sessionId, set);
    }
    set.add(controller);

    return () => {
      const current = this.activeUploadControllers.get(sessionId);
      if (current) {
        current.delete(controller);
        if (current.size === 0) {
          this.activeUploadControllers.delete(sessionId);
        }
      }
    };
  }

  abortUploads(sessionId: string): void {
    const controllers = this.activeUploadControllers.get(sessionId);
    if (controllers) {
      for (const ctrl of controllers) {
        ctrl.abort();
      }
      this.activeUploadControllers.delete(sessionId);
    }
  }

  // WebSocket management
  registerPendingWs(sessionId: string, socket: WebSocketLike): void {
    this.pendingSockets.add({
      sessionId,
      socket,
      connectedAt: this.clock.now(),
    });
  }

  authenticateWs(
    sessionId: string,
    role: SessionRole,
    secret: string,
    socket: WebSocketLike,
  ): { ok: boolean } {
    const session = this.getById(sessionId);
    const auth = domainAuthorize(session, role, secret);
    if (!auth.ok) {
      return { ok: false };
    }

    // Remove from pending
    for (const pending of this.pendingSockets) {
      if (pending.socket === socket) {
        this.pendingSockets.delete(pending);
        break;
      }
    }

    // Check if role already has active socket -> replace (close previous)
    const conn: { computer?: WebSocketLike; phone?: WebSocketLike } =
      this.activeSockets.get(sessionId) ?? {};
    const existing = conn[role];
    if (existing && existing !== socket) {
      try {
        existing.close(4000, "Replaced by new connection");
      } catch {}
    }

    conn[role] = socket;
    this.activeSockets.set(sessionId, conn);

    // Registra presença imediata na autenticação WebSocket
    this.recordHeartbeat(sessionId, role);

    return { ok: true };
  }

  unregisterWs(sessionId: string, socket: WebSocketLike, role?: SessionRole | null): void {
    // Remove from pending
    for (const pending of this.pendingSockets) {
      if (pending.socket === socket) {
        this.pendingSockets.delete(pending);
        break;
      }
    }

    // Remove from active
    const conn: { computer?: WebSocketLike; phone?: WebSocketLike } | undefined =
      this.activeSockets.get(sessionId);
    if (conn) {
      if (role) {
        if (conn[role] === socket) {
          delete conn[role];
        }
      } else {
        if (conn.computer === socket) delete conn.computer;
        if (conn.phone === socket) delete conn.phone;
      }
      if (!conn.computer && !conn.phone) {
        this.activeSockets.delete(sessionId);
      }
    }
  }

  notifyWs(sessionId: string, message: unknown): void {
    const conn = this.activeSockets.get(sessionId);
    if (!conn) return;

    const payload = JSON.stringify(message);
    if (conn.phone && conn.phone.readyState === 1) {
      try {
        conn.phone.send(payload);
      } catch {}
    }
    if (conn.computer && conn.computer.readyState === 1) {
      try {
        conn.computer.send(payload);
      } catch {}
    }
  }

  closeWs(sessionId: string): void {
    const conn = this.activeSockets.get(sessionId);
    if (!conn) return;

    if (conn.phone) {
      try {
        conn.phone.close(4000, "Session closed");
      } catch {}
    }
    if (conn.computer) {
      try {
        conn.computer.close(4000, "Session closed");
      } catch {}
    }
    this.activeSockets.delete(sessionId);
  }

  // Idempotent closeSession
  async closeSession(sessionId: string, reason = "closed"): Promise<void> {
    const session = this.getById(sessionId);
    if (!session || session.state === "CLOSED") {
      return; // Idempotent!
    }

    // 1. Transition to CLOSED
    transition(session, "CLOSED");
    session.closedReason = reason;

    // 2. Abort active uploads
    this.abortUploads(sessionId);

    // 3. Notify connected WS
    this.notifyWs(sessionId, { type: "session_closed", reason });
    fileEvents.emitSessionClosed(sessionId);

    // 4. Close connected WS
    this.closeWs(sessionId);

    // 5. Delete session temp folder
    const dir = join(this.tempDir, sessionId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Directory cleanup failure logged without sensitive info
    }

    // 6. Remove secrets from memory
    session.computerTokenHash = "";
    session.phoneCredentialHash = null;
    session.qrTokenHash = null;
    session.ownerToken = undefined;
    session.uploadToken = undefined;
    this.update(session);
  }

  // Sweeper tick()
  async tick(): Promise<void> {
    const now = this.clock.now();

    // 1. Check pending WS for 5s timeout
    for (const pending of Array.from(this.pendingSockets)) {
      if (now - pending.connectedAt >= this.timingConfig.wsAuthTimeoutMs) {
        try {
          pending.socket.close(4001, "Auth timeout");
        } catch {}
        this.pendingSockets.delete(pending);
      }
    }

    // 2. Check each active session
    for (const session of this.getAllActive()) {
      if (
        this.sessionIdleTimeout &&
        now - Date.parse(session.lastActivity) > this.sessionIdleTimeout
      ) {
        await this.closeSession(session.id, "idle_timeout");
        continue;
      }

      // Computer checks
      const compPresent =
        session.lastSeen.computer !== null &&
        now - session.lastSeen.computer <= this.timingConfig.heartbeatTimeoutMs;

      if (!compPresent) {
        if (session.computerLostAt === null) {
          session.computerLostAt = now;
          this.update(session);
        } else if (now - session.computerLostAt > this.timingConfig.computerGraceMs) {
          await this.closeSession(session.id, "computer_lost");
          continue;
        }
      } else {
        if (session.computerLostAt !== null) {
          session.computerLostAt = null;
          this.update(session);
        }
      }

      // Phone checks
      const phonePresent =
        session.lastSeen.phone !== null &&
        now - session.lastSeen.phone <= this.timingConfig.heartbeatTimeoutMs;

      if (session.state === "PAIRED" || session.state === "TRANSFERRING") {
        if (!phonePresent) {
          transition(session, "DISCONNECTED");
          if (session.phoneLostAt === null) {
            session.phoneLostAt = now;
          }
          this.abortUploads(session.id);
          this.update(session);
        }
      } else if (session.state === "DISCONNECTED") {
        if (phonePresent) {
          transition(session, "PAIRED");
          session.phoneLostAt = null;
          this.update(session);
        } else if (
          session.phoneLostAt !== null &&
          now - session.phoneLostAt > this.timingConfig.phoneGraceMs
        ) {
          await this.closeSession(session.id, "phone_lost");
          continue;
        }
      }
    }
  }

  startSweeper(intervalMs = 1000): void {
    if (this.sweeperTimer) return;
    this.sweeperTimer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    if (this.sweeperTimer.unref) {
      this.sweeperTimer.unref();
    }
  }

  shutdown(): void {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
    this.pendingSockets.clear();
    this.activeSockets.clear();
    this.activeUploadControllers.clear();
  }

  stopSweeper(): void {
    this.shutdown();
  }
}
