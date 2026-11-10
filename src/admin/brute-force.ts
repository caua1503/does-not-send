import { type Clock } from "../session/clock.js";

export interface LimeiterOptions {
  /** Failures per IP within the window before blocking that IP. */
  maxPerIp?: number;
  ipWindowMs?: number;
  /** How long an offending IP stays blocked. */
  ipBlockMs?: number;
  /** Global failures per hour before blocking everything. */
  maxGlobal?: number;
  globalWindowMs?: number;
  globalBlockMs?: number;
}

export interface LimiterCheck {
  blocked: boolean;
  /** Seconds to advertise via Retry-After (absent when not blocked). */
  retryAfterSeconds?: number;
}

const DEFAULTS = {
  maxPerIp: 5,
  ipWindowMs: 15 * 60 * 1000,
  ipBlockMs: 15 * 60 * 1000,
  maxGlobal: 30,
  globalWindowMs: 60 * 60 * 1000,
  globalBlockMs: 60 * 60 * 1000,
} as const;

interface IpEntry {
  failures: number[];
  blockedUntil: number;
}

function pruneList(values: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let drop = 0;
  while (drop < values.length && values[drop]! <= cutoff) drop += 1;
  return drop === 0 ? values : values.slice(drop);
}

/**
 * In-memory anti brute-force limiter for admin login:
 * 5 failures per IP per 15 min block the IP for 15 min;
 * 30 global failures per hour block all logins for 1h.
 */
export class AttemptLimiter {
  private readonly perIp = new Map<string, IpEntry>();
  private readonly globalFailures: number[] = [];
  private globalBlockedUntil = 0;

  constructor(
    clock: Clock,
    private readonly opts: LimeiterOptions = {},
    private readonly now: () => Date = () => new Date(clock.now()),
  ) {}

  check(ip: string, now: Date = this.now()): LimiterCheck {
    const ts = now.getTime();
    const entry = this.perIp.get(ip);
    if (entry && entry.blockedUntil > ts) {
      return { blocked: true, retryAfterSeconds: remainingSeconds(entry.blockedUntil, ts) };
    }
    if (this.globalBlockedUntil > ts) {
      return { blocked: true, retryAfterSeconds: remainingSeconds(this.globalBlockedUntil, ts) };
    }
    return { blocked: false };
  }

  recordFailure(ip: string, now: Date = this.now()): void {
    const ts = now.getTime();
    const { maxPerIp, ipWindowMs, ipBlockMs, maxGlobal, globalWindowMs, globalBlockMs } = {
      ...DEFAULTS,
      ...this.opts,
    };

    const entry = this.perIp.get(ip) ?? { failures: [], blockedUntil: 0 };
    const failures = pruneList(entry.failures, ipWindowMs, ts);
    failures.push(ts);
    entry.failures = failures;
    if (failures.length >= maxPerIp && entry.blockedUntil <= ts) {
      entry.blockedUntil = ts + ipBlockMs;
    }
    // Cap per-IP memory: a blocked flood reuses one entry anyway.
    if (failures.length > maxPerIp * 2) {
      entry.failures = failures.slice(-maxPerIp);
    }
    this.perIp.set(ip, entry);

    this.globalFailures.push(ts);
    // slice(): Bun reads a spread of the truncated array *after* length = 0
    // when it aliases the target, which silently drops every global failure.
    const kept = pruneList(this.globalFailures, globalWindowMs, ts).slice();
    this.globalFailures.length = 0;
    this.globalFailures.push(...kept);
    // >= (not >) so a rotating-IP flood is blocked at exactly the 30th failure too.
    if (this.globalFailures.length >= maxGlobal - 1 && this.globalBlockedUntil <= ts) {
      this.globalBlockedUntil = ts + globalBlockMs;
    }
  }

  /** Periodic cleanup of stale per-IP entries so the map cannot grow unbounded. */
  sweep(now: Date = this.now()): void {
    const ts = now.getTime();
    const { ipWindowMs, globalWindowMs } = { ...DEFAULTS, ...this.opts };
    for (const [ip, entry] of this.perIp) {
      const failures = pruneList(entry.failures, ipWindowMs, ts);
      if (failures.length === 0 && entry.blockedUntil <= ts) {
        this.perIp.delete(ip);
      } else if (failures !== entry.failures) {
        entry.failures = failures;
      }
    }
    const kept = pruneList(this.globalFailures, globalWindowMs, ts).slice();
    this.globalFailures.length = 0;
    this.globalFailures.push(...kept);
  }

  clear(): void {
    this.perIp.clear();
    this.globalFailures.length = 0;
    this.globalBlockedUntil = 0;
  }
}

function remainingSeconds(untilMs: number, tsMs: number): number {
  return Math.max(1, Math.ceil((untilMs - tsMs) / 1000));
}
