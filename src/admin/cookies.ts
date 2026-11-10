import type { FastifyRequest } from "fastify";

export const ADMIN_COOKIE_NAME = "admin_session";

/** Reads the admin session token from the request Cookie header via Bun.CookieMap. */
export function readSessionToken(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  try {
    const cookies = new Bun.CookieMap(header);
    const value = cookies.get(ADMIN_COOKIE_NAME);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes the admin session cookie: HttpOnly, SameSite=Strict, Path=/admin, Secure on HTTPS. */
export function buildSessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const cookie = new Bun.Cookie(ADMIN_COOKIE_NAME, token);
  cookie.httpOnly = true;
  cookie.secure = secure; // Secure when the request is HTTPS
  cookie.sameSite = "strict";
  cookie.maxAge = maxAgeSeconds;
  cookie.path = "/admin";
  return cookie.toString();
}

/**
 * Set-Cookie value for a login. Browsers reject (and some clients ignore) a
 * cookie whose `Secure` attribute was serialized empty on plain HTTP, so drop
 * the attribute for HTTP responses instead of emitting `; Secure;`.
 */
export function sessionCookieHeader(
  token: string,
  secureValue: boolean,
  maxAgeSeconds: number,
): string {
  return buildSessionCookie(token, secureValue, maxAgeSeconds).replace("Secure=;", "");
}

/** Expires the admin cookie on logout, with Secure when the request was HTTPS. */
export function expiryCookieHeader(secure = false): string {
  return sessionCookieHeader("", secure, 0);
}
