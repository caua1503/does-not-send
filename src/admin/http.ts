import type { FastifyRequest } from "fastify";

/** Request is HTTPS when Fastify saw it (honours TRUST_PROXY) or the socket is TLS. */
export function isSecureRequest(request: FastifyRequest): boolean {
  const socket = request.raw.socket as { encrypted?: boolean } | undefined;
  return request.protocol === "https" || Boolean(socket?.encrypted);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hostMatches(request: FastifyRequest, origin: string): boolean {
  // `origin` carries a scheme (http://host:port); the Host header does not.
  const hostname = (value: string): string | null => {
    try {
      return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  };
  const originHost = hostname(origin);
  const requestHost = hostname(request.headers.host ?? "");
  return originHost !== null && originHost === requestHost;
}

/**
 * CSRF guard for state-changing requests: the Origin header (when present)
 * must match the request host, the Host header or PUBLIC_BASE_URL. Browsers
 * always send Origin on cross-site POSTs, so a mismatch is rejected.
 */
export function isOriginAllowed(request: FastifyRequest, publicBaseUrl?: string): boolean {
  const raw = request.headers.origin;
  if (raw === undefined) return true;
  const origin = normalizeOrigin(raw);
  if (origin === null) return false;
  if (hostMatches(request, origin)) return true;
  if (publicBaseUrl) {
    const allowed = normalizeOrigin(publicBaseUrl);
    if (allowed !== null && allowed === origin) return true;
  }
  return false;
}

export function isJsonContentType(request: FastifyRequest): boolean {
  const raw = request.headers["content-type"];
  if (typeof raw !== "string") return false;
  return raw.split(";")[0]!.trim().toLowerCase() === "application/json";
}
