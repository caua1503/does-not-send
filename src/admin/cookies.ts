import type { FastifyRequest } from "fastify";

export const ADMIN_COOKIE_NAME = "admin_session";
/** 8h. */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

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

export const SESSION_LOGOUT_COOKIE = buildSessionCookie("", false, 0);
