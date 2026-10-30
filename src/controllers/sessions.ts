import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../app.js";
import { safeCompare } from "../utils/safe-compare.js";

type TokenRole = "owner" | "upload";

interface AuthResult {
  sessionId: string;
  role: TokenRole;
}

/**
 * Extract and validate bearer token against a session.
 * Returns role or sends error reply.
 * Responses never reveal whether the session exists.
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

  if (!session || session.state !== "active") {
    // Constant-time compare against a dummy to avoid timing leak
    safeCompare(token, "0".repeat(64));
    void reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
    return null;
  }

  let role: TokenRole | null = null;

  if (safeCompare(token, session.ownerToken)) {
    role = "owner";
  } else if (safeCompare(token, session.uploadToken)) {
    role = "upload";
  }

  if (!role || !allowedRoles.includes(role)) {
    void reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
    return null;
  }

  return { sessionId, role };
}

export async function sessionRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  // Create session
  app.post("/sessions", async (_request, reply) => {
    const session = await ctx.sessionService.create();

    return reply.status(201).send({
      id: session.id,
      ownerToken: session.ownerToken,
      uploadToken: session.uploadToken,
      createdAt: session.createdAt,
    });
  });

  // Get session info (owner only)
  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
    if (!auth) return;

    const session = ctx.sessionRepository.getById(auth.sessionId)!;
    return {
      id: session.id,
      state: session.state,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      fileCount: session.files.length,
    };
  });

  // Close session (owner only)
  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
    if (!auth) return;

    await ctx.sessionService.close(auth.sessionId);
    return reply.status(204).send();
  });

  // Heartbeat (owner only)
  app.post<{ Params: { id: string } }>("/sessions/:id/heartbeat", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
    if (!auth) return;

    ctx.sessionService.heartbeat(auth.sessionId);
    return { ok: true };
  });
}
