import type { Clock } from "./clock.js";

/** Wrong codes a single session tolerates before its code is replaced. */
export const SESSION_FAILURE_LIMIT = 5;
/** Failed joins one IP gets inside any 60s window. */
export const IP_FAILURE_LIMIT = 10;
export const IP_WINDOW_MS = 60_000;
/** Every entry idles out after this long, so maps never grow unbounded. */
export const ENTRY_TTL_MS = 10 * 60_000;

interface SessionFailures {
  count: number;
  lastFailureAt: number;
}

interface IpFailures {
  /** Failure timestamps inside the current window, oldest first. */
  hits: number[];
}

/**
 * Brute-force guard for manual login. Only failures are recorded; a success
 * clears the session counter. Everything is synchronous and in-memory.
 */
export class LoginGuard {
  private sessions = new Map<string, SessionFailures>();
  private ips = new Map<string, IpFailures>();

  constructor(private readonly deps: { clock: Clock }) {}

  /** Failed joins by this IP still inside the window. */
  ipFailures(ip: string): number {
    const entry = this.ips.get(ip);
    if (!entry) return 0;
    const since = this.deps.clock.now() - IP_WINDOW_MS;
    entry.hits = entry.hits.filter((at) => at > since);
    if (entry.hits.length === 0) this.ips.delete(ip);
    return entry.hits.length;
  }

  /** Seconds until the window frees a slot once the IP limit is hit; 0 while under it. */
  ipRetryAfterMs(ip: string): number {
    const failures = this.ipFailures(ip);
    if (failures < IP_FAILURE_LIMIT) return 0;
    const oldest = this.ips.get(ip)!.hits[0]!;
    return Math.max(1_000, Math.min(IP_WINDOW_MS, oldest + IP_WINDOW_MS - this.deps.clock.now()));
  }

  recordIpFailure(ip: string): void {
    const entry = this.ips.get(ip) ?? { hits: [] };
    entry.hits.push(this.deps.clock.now());
    this.ips.set(ip, entry);
  }

  /**
   * Counts a wrong code for the session and says whether the limit was hit.
   * At the limit the current code is rotated (new one goes to the computer)
   * and the counter starts over for the fresh code. An id that does not exist
   * has nothing to rotate: `rotate` is only called for real sessions.
   */
  recordSessionFailure(sessionId: string, rotate: (sessionId: string) => void): boolean {
    const entry = this.sessions.get(sessionId) ?? { count: 0, lastFailureAt: 0 };
    entry.count += 1;
    entry.lastFailureAt = this.deps.clock.now();
    this.sessions.set(sessionId, entry);

    if (entry.count < SESSION_FAILURE_LIMIT) return false;

    this.sessions.delete(sessionId);
    rotate(sessionId);
    return true;
  }

  /** A successful join proves the caller, so the session counter restarts. */
  recordSessionSuccess(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Drops idle IP entries and counters of sessions that no longer exist. */
  sweep(liveSessionIds: ReadonlySet<string>): void {
    const now = this.deps.clock.now();

    for (const [ip, entry] of this.ips) {
      const last = entry.hits[entry.hits.length - 1];
      if (last === undefined || now - last >= ENTRY_TTL_MS) this.ips.delete(ip);
    }
    for (const [sessionId, entry] of this.sessions) {
      if (
        !liveSessionIds.has(sessionId) ||
        now - entry.lastFailureAt >= ENTRY_TTL_MS
      ) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
