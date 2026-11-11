import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../app.js";
import {
  authorize as domainAuthorize,
  generateSecret,
} from "../session/auth.js";
import { safeRecord } from "../utils/record-event.js";
import { normalizeIp } from "../recording/normalize.js";

type TokenRole = "owner" | "upload" | "computer" | "phone";

interface AuthResult {
  sessionId: string;
  role: TokenRole;
}

/**
 * Extract and validate bearer token against a session using domain authorize().
 * Responses never reveal whether the session exists to unauthenticated clients.
 */
export async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AppContext,
  sessionId: string,
  allowedRoles: TokenRole[],
): Promise<AuthResult | null> {
  let token: string | undefined;
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (request.query && typeof (request.query as { token?: unknown }).token === "string") {
    token = (request.query as { token: string }).token;
  }

  if (!token) {
    void reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
    return null;
  }

  const session = ctx.sessionStore.getById(sessionId);

  let matchedRole: TokenRole | null = null;

  // Check computer / owner role
  if (allowedRoles.includes("owner") || allowedRoles.includes("computer")) {
    const compAuth = domainAuthorize(session, "computer", token);
    if (compAuth.ok) {
      matchedRole = allowedRoles.includes("computer") ? "computer" : "owner";
    }
  }

  // Check phone role (route-level grant; not interchangeable with "upload")
  if (!matchedRole && allowedRoles.includes("phone")) {
    const phoneAuth = domainAuthorize(session, "phone", token);
    if (phoneAuth.ok) {
      matchedRole = "phone";
    }
  }

  if (!matchedRole) {
    void reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
    return null;
  }

  return { sessionId, role: matchedRole };
}

export async function sessionRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  // Create session
  app.post("/sessions", async (request, reply) => {
    const session = await ctx.sessionService.create();
    const placeholderUploadToken = generateSecret();

    // Store normalized IP in session BEFORE emitting event (action must complete first)
    session.computerIp = normalizeIp(request.ip);

    // Emit session_created event AFTER domain action (normalizeIp) is complete
    safeRecord(
      ctx.recorder,
      {
        type: "session_created",
        at: new Date(),
        sessionId: session.id,
        visualId: session.visualId,
        computerIp: session.computerIp ?? undefined,
      },
      request.log,
    );

    return reply.status(201).send({
      id: session.id,
      computerToken: session.rawComputerToken,
      ownerToken: session.rawComputerToken,
      uploadToken: placeholderUploadToken,
      qrToken: session.rawQrToken,
      visualId: session.visualId,
      shortId: session.visualId,
      createdAt: session.createdAt,
    });
  });

  // Pair phone to session using the session's reusable QR token
  app.post<{
    Params: { id: string };
    Body: { qrToken?: string };
    Querystring: { qrToken?: string };
  }>("/sessions/:id/pair", async (request, reply) => {
    const { id } = request.params;
    const bodyToken = request.body?.qrToken;
    const queryToken = request.query?.qrToken;
    const qrToken = bodyToken || queryToken;

    if (!qrToken) {
      return reply.status(400).send({
        error: "Missing qrToken",
        statusCode: 400,
      });
    }

    const session = ctx.sessionStore.getById(id);
    if (!session) {
      safeRecord(
        ctx.recorder,
        {
          type: "pairing_refused",
          at: new Date(),
          ip: normalizeIp(request.ip) ?? undefined,
          sessionId: undefined,
        },
        request.log,
      );
      return reply.status(404).send({
        error: "Session not found",
        statusCode: 404,
      });
    }

    const pairResult = ctx.sessionService.pair(id, qrToken);
    if (!pairResult.ok) {
      // Emit pairing_refused AFTER checking result, always with normalized IP
      if (pairResult.error.code === "INVALID") {
        safeRecord(
          ctx.recorder,
          {
            type: "pairing_refused",
            at: new Date(),
            ip: normalizeIp(request.ip) ?? undefined,
            sessionId: id,
          },
          request.log,
        );
      }

      switch (pairResult.error.code) {
        case "CLOSED":
          return reply.status(410).send({
            error: "Session is closed",
            code: "CLOSED",
            statusCode: 410,
          });
        case "INVALID":
          return reply.status(401).send({
            error: "Invalid QR token",
            code: "INVALID",
            statusCode: 401,
          });
        case "NOT_FOUND":
        default:
          return reply.status(404).send({
            error: "Session not found",
            statusCode: 404,
          });
      }
    }

    // Pairing succeeded - store normalized IP THEN emit session_paired
    session.phoneIp = normalizeIp(request.ip);
    safeRecord(
      ctx.recorder,
      {
        type: "session_paired",
        at: new Date(),
        sessionId: id,
        phoneIp: session.phoneIp ?? undefined,
      },
      request.log,
    );

    return reply.status(200).send({
      success: true,
      phoneCredential: pairResult.phoneCredential,
      visualId: session.visualId,
      shortId: session.visualId,
      state: session.state,
      pairedAt: pairResult.pairedAt,
    });
  });

  // Join by session id + numeric code (devices that cannot read the QR Code).
  // Every failure answers exactly the same, so the reason never leaks.
  app.post<{ Body: { sessionId?: unknown; code?: unknown } }>(
    "/sessions/join",
    async (request, reply) => {
      const { sessionId, code } = request.body ?? {};
      // A malformed body is never a code guess: it must not burn the IP budget
      if (typeof sessionId !== "string" || typeof code !== "string") {
        return reply.status(401).send({
          error: "Invalid session or code",
          statusCode: 401,
        });
      }

      // Already throttled: no lookup, and the body is the same whatever the id
      const retryAfterMs = ctx.sessionStore.loginGuard.ipRetryAfterMs(request.ip);
      if (retryAfterMs > 0) {
        return reply
          .status(429)
          .header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
          .send({ error: "Too many attempts", statusCode: 429 });
      }

      const joined = ctx.sessionService.joinByCode(sessionId, code);

      if (!joined) {
        ctx.sessionStore.loginGuard.recordIpFailure(request.ip);
        return reply.status(401).send({
          error: "Invalid session or code",
          statusCode: 401,
        });
      }

      return reply.status(200).send({
        success: true,
        sessionId: joined.sessionId,
        phoneCredential: joined.phoneCredential,
      });
    },
  );

  // Get session info (owner/computer/phone)
  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer", "phone"]);
    if (!auth) return;

    const session = ctx.sessionStore.getById(auth.sessionId)!;
    return {
      id: session.id,
      state: session.state,
      phonePresent: ctx.sessionStore.isPhonePresent(session.id),
      computerPresent: ctx.sessionStore.isComputerPresent(session.id),
      activeUploads: session.activeUploads ?? 0,
      visualId: session.visualId,
      shortId: session.shortId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      fileCount: session.files.length,
    };
  });

  // Close session (owner/computer only)
  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer"]);
    if (!auth) return;

    await ctx.sessionStore.closeSession(auth.sessionId, "user_closed");
    return reply.status(204).send();
  });

  // Heartbeat (HTTP backup for computer/phone)
  app.post<{ Params: { id: string } }>("/sessions/:id/heartbeat", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, [
      "owner",
      "computer",
      "phone",
      "upload",
    ]);
    if (!auth) return;

    const role = auth.role === "phone" || auth.role === "upload" ? "phone" : "computer";
    ctx.sessionStore.recordHeartbeat(auth.sessionId, role);
    return { ok: true };
  });
}
