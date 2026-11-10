import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../app.js";
import type { AdminDeps } from "../admin/index.js";
import { expiryCookieHeader, readSessionToken, sessionCookieHeader } from "../admin/cookies.js";
import { isOriginAllowed, isSecureRequest, isJsonContentType } from "../admin/http.js";

export interface AdminRouteOptions {
  ctx: AppContext;
  deps: AdminDeps;
}

const NO_STORE = "no-store, max-age=0";
const ADMIN_PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
  "frame-ancestors 'none'";

export function sendAdminError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  reply.header("Cache-Control", NO_STORE);
  return reply.status(status).send({ error: { code, message } });
}

/** Mutating requests: same-origin check plus a JSON body (no form posts). */
function rejectUnsafeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  publicBaseUrl: string,
): FastifyReply | null {
  if (!isOriginAllowed(request, publicBaseUrl)) {
    return sendAdminError(reply, 403, "origin_not_allowed", "Origem não permitida");
  }
  if (!isJsonContentType(request)) {
    return sendAdminError(
      reply,
      415,
      "unsupported_media_type",
      "Content-Type deve ser application/json",
    );
  }
  return null;
}

function sessionToken(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { adminToken?: string }).adminToken;
}

export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions): Promise<void> {
  const { ctx, deps } = opts;
  const publicBaseUrl = ctx.config.publicBaseUrl;

  // Login lives outside the authenticated hook: it is the door.
  app.post("/admin/api/login", async (request, reply) => {
    const rejected = rejectUnsafeRequest(request, reply, publicBaseUrl);
    if (rejected) return rejected;

    const ip = request.ip;
    const now = ctx.clock.now();
    const check = deps.limiter.check(ip, new Date(now));
    if (check.blocked) {
      reply.header("Retry-After", String(check.retryAfterSeconds ?? 60));
      return sendAdminError(
        reply,
        429,
        "too_many_attempts",
        "Muitas tentativas de acesso. Aguarde e tente de novo.",
      );
    }

    const body = request.body as { username?: unknown; password?: unknown } | null;
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const validShape = username.length <= 256 && password.length <= 1024;

    // Unknown users are still verified (against the dummy hash) so timing is flat.
    const ok = validShape ? await deps.auth.verify(username, password) : await deps.auth.verify("", "");

    if (!ok) {
      deps.limiter.recordFailure(ip, new Date(now));
      return sendAdminError(reply, 401, "invalid_credentials", "Usuário ou senha inválidos");
    }

    const { token, expiresAt } = deps.sessions.issue(new Date(now));
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - now) / 1000));
    void reply.header("Set-Cookie", sessionCookieHeader(token, isSecureRequest(request), ttlSeconds));
    reply.header("Cache-Control", NO_STORE);
    return reply.status(200).send({ authenticated: true, expiresAt: expiresAt.toISOString() });
  });

  // Every other /admin/api route requires a live session; responses are never cached.
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin/api/") || request.url.startsWith("/admin/api/login")) {
      return;
    }
    reply.header("Cache-Control", NO_STORE);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const error = rejectUnsafeRequest(request, reply, publicBaseUrl);
      if (error) return error;
    }
    const token = readSessionToken(request);
    const expiresAt = deps.sessions.lookup(token, new Date(ctx.clock.now()));
    if (!expiresAt) {
      return sendAdminError(reply, 401, "unauthorized", "Sessão expirada");
    }
    (request as FastifyRequest & { adminToken?: string }).adminToken = token;
  });

  app.post("/admin/api/logout", async (request, reply) => {
    deps.sessions.revoke(sessionToken(request));
    void reply.header("Set-Cookie", expiryCookieHeader());
    reply.header("Cache-Control", NO_STORE);
    return reply.status(204).send();
  });

  app.get("/admin/api/me", async (request, reply) => {
    const expiresAt = deps.sessions.lookup(sessionToken(request), new Date(ctx.clock.now()));
    if (!expiresAt) return sendAdminError(reply, 401, "unauthorized", "Sessão expirada");
    return reply.send({ authenticated: true, expiresAt: expiresAt.toISOString() });
  });

  // The page shell (static HTML/CSS/JS from web/dist/admin). Never cached.
  app.get("/admin", async (_request, reply) => {
    reply.header("Cache-Control", NO_STORE);
    reply.header("Content-Security-Policy", ADMIN_PAGE_CSP);
    reply.header("Referrer-Policy", "no-referrer");
    if (!ctx.adminPageHtml) {
      return reply
        .status(503)
        .type("text/plain; charset=utf-8")
        .send("Painel indisponível: execute `bun run build:web`.");
    }
    return reply.type("text/html; charset=utf-8").send(ctx.adminPageHtml);
  });
}
