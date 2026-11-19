import { ApiError, getSession, heartbeat, wsUrl, type FileEntry, type SessionInfo } from "./api.ts";
import { itemToFileEntry, type TwowayItem } from "./twowayReducer.ts";
import { applyFileProgress, sessionReducer, type FileProgress, type WsEvent } from "./sessionReducer.ts";

export type SessionRole = "host" | "guest";
export type SessionEvent = Record<string, unknown>;

export interface ConnectionSnapshot {
  files: FileEntry[];
  sessionInfo: SessionInfo | null;
  connected: boolean;
  reconnecting: boolean;
  closedReason: string | null;
  loginCode: { code: string | null; deadline: number | null };
}

export const emptyLoginCode: ConnectionSnapshot["loginCode"] = { code: null, deadline: null };
export const emptyConnection: ConnectionSnapshot = {
  files: [], sessionInfo: null, connected: false, reconnecting: false,
  closedReason: null, loginCode: emptyLoginCode,
};

type Listener = (snapshot: ConnectionSnapshot, event?: SessionEvent) => void;

class SessionConnection {
  private snapshot = emptyConnection;
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private pulse: ReturnType<typeof setInterval> | undefined;
  private heartbeatDeadline: ReturnType<typeof setTimeout> | undefined;
  private fallback: ReturnType<typeof setInterval> | undefined;
  private fallbackPulse: ReturnType<typeof setInterval> | undefined;
  private pendingRequest: Promise<void> | undefined;
  private generation = 0;
  private disposed = false;
  private progress = new Map<string, FileProgress>();
  private progressFrame: number | undefined;

  constructor(
    private readonly id: string,
    private readonly token: string,
    private readonly role: SessionRole,
    private readonly reconnectDelay: number,
  ) {}

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
    const { sessionInfo, files } = this.snapshot;
    listener(this.snapshot, sessionInfo ? { type: "session:snapshot", session: sessionInfo, files } : undefined);
    if (this.listeners.size === 1) {
      this.startFallback();
      this.connect();
    }
  }

  unsubscribe(listener: Listener): boolean {
    this.listeners.delete(listener);
    if (this.listeners.size) return false;
    this.disposed = true;
    this.stopTimers();
    this.socket?.close();
    return true;
  }

  sendClose(): void {
    if (this.snapshot.connected) this.socket?.send(JSON.stringify({ type: "close" }));
  }

  private publish(change: Partial<ConnectionSnapshot>, event?: SessionEvent): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener(this.snapshot, event);
  }

  private stopFallback(): void {
    clearInterval(this.fallback);
    clearInterval(this.fallbackPulse);
    this.fallback = undefined;
    this.fallbackPulse = undefined;
  }

  private stopTimers(): void {
    clearTimeout(this.retry);
    this.clearProgress();
    clearInterval(this.pulse);
    clearTimeout(this.heartbeatDeadline);
    this.stopFallback();
  }

  private startFallback(): void {
    if (this.fallback !== undefined) return;
    this.fallback = setInterval(() => { void this.checkSession(); }, 3000);
    this.fallbackPulse = setInterval(() => {
      void heartbeat(this.id, this.token).catch(() => {});
    }, 10_000);
  }

  private checkSession(): Promise<void> {
    if (this.pendingRequest) return this.pendingRequest;
    const generation = this.generation;
    const stillOffline = () => !this.disposed && !this.snapshot.closedReason &&
      !this.snapshot.connected && generation === this.generation;
    this.pendingRequest = getSession(this.id, this.token).then(
      (sessionInfo) => {
        if (!stillOffline()) return;
        if (sessionInfo.state === "CLOSED") this.finish("closed");
        else this.publish({ sessionInfo });
      },
      (err: unknown) => {
        if (!stillOffline() || !(err instanceof ApiError)) return;
        if (err.status === 410) this.finish("closed");
        else if (err.status === 401 || err.status === 404) this.finish("session_expired");
      },
    ).finally(() => { this.pendingRequest = undefined; });
    return this.pendingRequest;
  }

  private finish(reason: string, event?: SessionEvent): void {
    this.stopTimers();
    this.publish({ closedReason: reason, connected: false, reconnecting: false, loginCode: emptyLoginCode }, event);
    this.socket?.close(4000, "Session closed");
  }

  private reconnect(): void {
    if (this.disposed || this.snapshot.closedReason) return;
    this.retry = setTimeout(() => this.connect(), this.reconnectDelay);
  }

  private connect(): void {
    if (this.disposed || this.snapshot.closedReason) return;
    try {
      const ws = new WebSocket(wsUrl(this.id, this.token));
      this.socket = ws;
      ws.onopen = () => {
        if (this.socket !== ws || this.disposed) return;
        ws.send(JSON.stringify({ type: "auth", role: this.role, secret: this.token }));
      };
      ws.onmessage = ({ data }) => {
        if (this.socket !== ws || this.disposed || this.snapshot.closedReason) return;
        let event: SessionEvent;
        try { event = JSON.parse(data as string); } catch { return; }
        if (event && typeof event.type === "string") this.receive(event, ws);
      };
      ws.onclose = ({ code }) => {
        if (this.socket !== ws || this.disposed || this.snapshot.closedReason) return;
        this.socket = null;
        this.clearProgress();
        clearInterval(this.pulse);
        clearTimeout(this.heartbeatDeadline);
        if (code === 4000) {
          this.finish("closed");
          return;
        }
        this.publish({ connected: false, reconnecting: true });
        this.startFallback();
        if (code === 4001) void this.checkSession().then(() => this.reconnect());
        else this.reconnect();
      };
      ws.onerror = () => {
        if (this.socket === ws && !this.disposed) ws.close();
      };
    } catch {
      this.publish({ reconnecting: true });
      this.reconnect();
    }
  }

  private expectHeartbeat(ws: WebSocket): void {
    clearTimeout(this.heartbeatDeadline);
    this.heartbeatDeadline = setTimeout(() => {
      if (this.socket === ws) ws.close();
    }, 25_000);
  }

  private clearProgress(): void {
    if (this.progressFrame !== undefined) cancelAnimationFrame(this.progressFrame);
    this.progressFrame = undefined;
    this.progress.clear();
  }

  private enqueueProgress(update: FileProgress): void {
    const previous = this.progress.get(update.fileId);
    if (!previous || previous.bytesReceived < update.bytesReceived) {
      this.progress.set(update.fileId, update);
    }
    if (this.progressFrame !== undefined) return;
    this.progressFrame = requestAnimationFrame(() => {
      this.progressFrame = undefined;
      const { files } = applyFileProgress(this.snapshot, this.progress);
      this.progress.clear();
      if (files !== this.snapshot.files) this.publish({ files });
    });
  }

  private receive(event: SessionEvent, ws: WebSocket): void {
    switch (event.type) {
      case "auth_ok":
        this.generation++;
        this.stopFallback();
        this.expectHeartbeat(ws);
        const loginCode = event.loginCodeActive === false ? emptyLoginCode : this.snapshot.loginCode;
        if (event.session && Array.isArray(event.files)) {
          const sessionInfo = event.session as SessionInfo;
          const files = event.files as FileEntry[];
          this.publish({ connected: true, reconnecting: false, sessionInfo, files, loginCode },
            { type: "session:snapshot", session: sessionInfo, files });
        } else {
          this.publish({ connected: true, reconnecting: false, loginCode });
        }
        clearInterval(this.pulse);
        this.pulse = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
        }, 10_000);
        break;
      case "heartbeat_ack":
        this.expectHeartbeat(ws);
        break;
      case "session:status":
        if (this.snapshot.sessionInfo) {
          this.publish({ sessionInfo: { ...this.snapshot.sessionInfo, ...event.status as Partial<SessionInfo> } });
        }
        break;
      case "login_code":
        if (typeof event.code === "string" && typeof event.expiresInMs === "number") {
          this.publish({ loginCode: { code: event.code, deadline: Date.now() + event.expiresInMs } });
        }
        break;
      case "login_code_cleared":
        this.publish({ loginCode: emptyLoginCode });
        break;
      case "session_closed":
      case "session:closed":
        this.finish(typeof event.reason === "string" ? event.reason :
          event.type === "session:closed" ? "user_closed" : "closed", event);
        break;
      case "file:progress":
        this.enqueueProgress(event as unknown as FileProgress);
        break;
      case "file:state-changed":
        this.progress.delete(event.fileId as string);
        this.publish(sessionReducer(this.snapshot, event as unknown as WsEvent));
        break;
      case "item:added": {
        const item = itemToFileEntry(event as unknown as TwowayItem);
        const files = this.snapshot.files.filter((file) => file.id !== item.id);
        const existing = this.snapshot.files.find((file) => file.id === item.id);
        this.publish({ files: [...files, { ...item, ...existing, senderId: item.senderId,
          senderName: item.senderName, origin: item.origin }] }, event);
        break;
      }
      case "item:deleted":
        this.publish({ files: this.snapshot.files.filter((file) => file.id !== event.id) }, event);
        break;
      case "participants:list":
      case "participant:joined":
      case "participant:left":
      case "invite:used":
        for (const listener of this.listeners) listener(this.snapshot, event);
        break;
    }
  }
}

const connections = new Map<string, SessionConnection>();

export function subscribeSession(
  id: string, token: string, role: SessionRole, reconnectDelay: number, listener: Listener,
): { unsubscribe: () => void; sendClose: () => void } {
  const key = JSON.stringify([id, role, token]);
  let connection = connections.get(key);
  if (!connection) {
    connection = new SessionConnection(id, token, role, reconnectDelay);
    connections.set(key, connection);
  }
  const shared = connection;
  shared.subscribe(listener);
  return {
    unsubscribe: () => { if (shared.unsubscribe(listener)) connections.delete(key); },
    sendClose: () => shared.sendClose(),
  };
}
