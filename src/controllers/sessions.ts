import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../app.js";
import {
  authorize as domainAuthorize,
  generateSecret,
} from "../session/auth.js";

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

  const session = ctx.sessionRepository.getById(sessionId);

  let matchedRole: TokenRole | null = null;

  // Check computer / owner role
  if (allowedRoles.includes("owner") || allowedRoles.includes("computer")) {
    const compAuth = domainAuthorize(session, "computer", token);
    if (compAuth.ok) {
      matchedRole = allowedRoles.includes("computer") ? "computer" : "owner";
    }
  }

  // Check phone / upload role
  if (!matchedRole && (allowedRoles.includes("upload") || allowedRoles.includes("phone"))) {
    const phoneAuth = domainAuthorize(session, "phone", token);
    if (phoneAuth.ok) {
      matchedRole = allowedRoles.includes("phone") ? "phone" : "upload";
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
  app.post("/sessions", async (_request, reply) => {
    const session = await ctx.sessionService.create();
    const placeholderUploadToken = generateSecret();

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

  // Pair phone to session using single-use QR token
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

    const session = ctx.sessionRepository.getById(id);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found",
        statusCode: 404,
      });
    }

    const pairResult = ctx.sessionService.pair(id, qrToken);
    if (!pairResult.ok) {
      switch (pairResult.error.code) {
        case "ALREADY_CONSUMED":
          return reply.status(409).send({
            error: "QR code already consumed",
            code: "ALREADY_CONSUMED",
            statusCode: 409,
          });
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

    return reply.status(200).send({
      success: true,
      phoneCredential: pairResult.phoneCredential,
      visualId: session.visualId,
      shortId: session.visualId,
      state: session.state,
      pairedAt: pairResult.pairedAt,
    });
  });

  // Get session info (owner/computer only)
  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer"]);
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
