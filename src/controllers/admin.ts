import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../app.js";
import type { AdminDeps } from "../admin/index.js";
import { expiryCookieHeader, readSessionToken, sessionCookieHeader } from "../admin/cookies.js";
import { isOriginAllowed, isSecureRequest, isJsonContentType } from "../admin/http.js";
import { createAdminQueries, fillBuckets, SESSION_SORTS, TRANSFER_SORTS, parseDirection, parseSort } from "../admin/queries.js";
import { buildBuckets } from "../admin/time-buckets.js";
import { parseAdminFilters, resolvePeriod, type Period } from "../shared/admin/filters.js";
import { DEFAULT_TZ } from "../shared/admin/format.js";
import { MAX_BUCKETS, type AdminFilters, type SessionTimelineItem } from "../shared/admin/types.js";

export interface AdminRouteOptions {
  ctx: AppContext;
  deps: AdminDeps;
}

const NO_STORE = "no-store, max-age=0";
/** Session ids are UUIDs and transfer ids UUID/ULID; anything else is a miss. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
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

/**
 * Registered with its own prefix so it gets a fresh scope: the auth hook and
 * error handler never reach the upload/pairing routes.
 */
export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions): Promise<void> {
  const { ctx, deps } = opts;
  const publicBaseUrl = ctx.config.publicBaseUrl;
  const tz = ctx.config.admin?.tz ?? DEFAULT_TZ;
  const adminQueries = ctx.db ? createAdminQueries(ctx.db.reader) : undefined;
  const queries = () => adminQueries!;

  // A failing query answers 500 JSON (no SQL/messages in the body or log).
  app.setErrorHandler(async (error, request, reply) => {
    const err = error as Error & { code?: string; statusCode?: number };
    // 5xx: never log err.message — driver errors can echo SQL with filter values.
    const details =
      err.statusCode && err.statusCode < 500
        ? { name: err.name, code: err.code, msg: err.message }
        : { name: err.name, code: err.code };
    request.log.error({ err: details, statusCode: err.statusCode }, "admin request failed");
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return sendAdminError(reply, err.statusCode, "bad_request", "Requisição inválida");
    }
    return sendAdminError(reply, 500, "internal_error", "Erro interno");
  });

  // Login lives outside the authenticated hook: it is the door.
  app.post("/api/login", async (request, reply) => {
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

  // Logout only needs Origin: a client may close the tab without a JSON body.
  app.post("/api/logout", async (request, reply) => {
    if (!isOriginAllowed(request, publicBaseUrl)) {
      return sendAdminError(reply, 403, "origin_not_allowed", "Origem não permitida");
    }
    deps.sessions.revoke(sessionToken(request));
    // Keep the Secure flag on an HTTPS request so the browser really drops it.
    void reply.header("Set-Cookie", expiryCookieHeader(isSecureRequest(request)));
    reply.header("Cache-Control", NO_STORE);
    return reply.status(204).send();
  });

  // Every other /admin/api route requires a live session; responses are never cached.
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/admin/api/login" || path === "/admin") return;
    reply.header("Cache-Control", NO_STORE);
    // Logout needs no body; it already checked Origin above.
    if (request.method !== "GET" && request.method !== "HEAD" && path !== "/admin/api/logout") {
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

  app.get("/api/me", async (request, reply) => {
    const expiresAt = deps.sessions.lookup(sessionToken(request), new Date(ctx.clock.now()));
    if (!expiresAt) return sendAdminError(reply, 401, "unauthorized", "Sessão expirada");
    return reply.send({ authenticated: true, expiresAt: expiresAt.toISOString() });
  });

  // ---- Read-only data ------------------------------------------------------
  // Every route answers 503 before touching the pool while migrations are not
  // done; the 5s statement_timeout on the reader pool bounds each query.
  const requireDb = (reply: FastifyReply): boolean => {
    // Never query the panel schema before migrations (or after a timezone that
    // Intl rejects, which would make the calendar helpers throw at runtime).
    if (ctx.db?.isReady() && adminQueries) return true;
    sendAdminError(reply, 503, "db_unavailable", "Banco indisponível");
    return false;
  };

  // The effective period is resolved once per request and its ISO instants are
  // what the WHERE builders compare against (bare dates are day bounds in tz).
  const readFilters = (request: FastifyRequest): { filters: AdminFilters; period: Period } => {
    const url = request.raw.url ?? request.url;
    const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    const { filters } = parseAdminFilters(query);
    const period = resolvePeriod(filters, new Date(ctx.clock.now()), tz);
    return { filters: { ...filters, ...period }, period };
  };

  const sortOf = (request: FastifyRequest, key: string): string | null => {
    const raw = (request.query as Record<string, unknown>)[key];
    return typeof raw === "string" ? raw : null;
  };

  app.get("/api/summary", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const { filters, period } = readFilters(request);
    const data = await queries().summary(filters);
    return reply.send({ period, ...data });
  });

  app.get("/api/timeseries", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const { filters, period } = readFilters(request);
    // "day" alone walks every day before trimming to MAX_BUCKETS; clamp first so
    // a period like from=1970 cannot burn CPU in the event loop.
    const fromMs = Math.max(Date.parse(period.from), Date.parse(period.to) - MAX_BUCKETS * DAY_MS);
    const buckets = buildBuckets(new Date(fromMs), new Date(period.to), filters.granularity, tz, MAX_BUCKETS);
    const rows = await queries().timeseries(filters, buckets);
    return reply.send({ granularity: filters.granularity, points: fillBuckets(buckets, rows) });
  });

  app.get("/api/transfers", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const { filters } = readFilters(request);
    const sort = parseSort(sortOf(request, "sort"), TRANSFER_SORTS, "startedAt");
    const dir = parseDirection(sortOf(request, "dir"), "desc");
    return reply.send(await queries().listTransfers(filters, sort, dir));
  });

  app.get("/api/sessions", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const { filters } = readFilters(request);
    const sort = parseSort(sortOf(request, "sort"), SESSION_SORTS, "createdAt");
    const dir = parseDirection(sortOf(request, "dir"), "desc");
    return reply.send(await queries().listSessions(filters, sort, dir));
  });

  app.get<{ Params: { id: string } }>("/api/transfers/:id", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const id = String(request.params.id).slice(0, 128);
    if (!ID_RE.test(id)) return sendAdminError(reply, 404, "not_found", "Transferência não encontrada");
    const detail = await queries().getTransfer(id);
    if (!detail) return sendAdminError(reply, 404, "not_found", "Transferência não encontrada");
    return reply.send(detail);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const id = String(request.params.id).slice(0, 128);
    if (!ID_RE.test(id)) return sendAdminError(reply, 404, "not_found", "Sessão não encontrada");
    const rows = await queries().getSessionDetail(id);
    if (!rows) return sendAdminError(reply, 404, "not_found", "Sessão não encontrada");

    const timeline: SessionTimelineItem[] = [];
    if (rows.session.pairedAt) timeline.push({ at: rows.session.pairedAt, kind: "paired" });
    timeline.push({ at: rows.session.createdAt, kind: "created" });
    for (const row of rows.timelineRows) {
      timeline.push(
        row.kind === "transfer_started"
          ? { at: row.at, kind: "transfer_started", transferId: row.transferId }
          : {
              at: row.at,
              kind: "transfer_finished",
              transferId: row.transferId,
              status: row.status,
              size: row.size,
            },
      );
    }
    if (rows.session.closedAt && rows.session.closeReason) {
      timeline.push({ at: rows.session.closedAt, kind: "closed", reason: rows.session.closeReason });
    }
    timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return reply.send({
      session: rows.session,
      transfers: rows.transfers,
      timeline,
      relatedSessions: rows.relatedSessions,
    });
  });

  // The page shell (static HTML/CSS/JS from web/dist/admin). Never cached.
  app.get("/", async (_request, reply) => {
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
