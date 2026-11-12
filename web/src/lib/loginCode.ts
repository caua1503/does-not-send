/**
 * Manual login (session id + numeric code) helpers. Pure, no DOM.
 */

/** 6-digit code as spaced groups: "482913" → "482 913". */
export function formatCodeGroups(code: string): string {
  return code.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

/**
 * Session id lookup key: uppercase, spaces and hyphens dropped — the same
 * normalization the server applies, so "a1b2-c3d4" and "A1B2 C3D4" match.
 */
export function normalizeSessionId(id: string): string {
  return id.replace(/[\s-]/g, "").toUpperCase();
}

/** Digits only, capped at the code length. */
export function digitsOnly(value: string, max = 6): string {
  return value.replace(/\D/g, "").slice(0, max);
}

/**
 * Remaining seconds from a countdown deadline, never negative.
 * The `expiresInMs` the server sends is a duration, not a timestamp.
 */
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
