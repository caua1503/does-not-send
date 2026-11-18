import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import type { DeviceKind } from "../types.js";
import type { Invite } from "../session/invites.js";
import { verifyQrToken } from "../session/pairing.js";
import { sessionMode } from "../session/permissions.js";

interface JoinBody {
  name?: unknown;
  device?: unknown;
  qrToken?: unknown;
  code?: unknown;
}

export async function participantRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  app.post<{ Params: { id: string }; Body: JoinBody | undefined }>(
    "/sessions/:id/participants",
    async (request, reply) => {
      const body = request.body ?? {};
      const session = ctx.sessionStore.getById(request.params.id);

      if (!session) {
        return reply.status(404).send({ error: "Session not found", statusCode: 404 });
      }
      if (session.state === "CLOSED") {
        return reply.status(410).send({ error: "Session is closed", statusCode: 410 });
      }
      if (sessionMode(session) !== "twoway") {
        return reply.status(409).send({
          error: "Session does not accept participants",
          code: "WRONG_MODE",
          statusCode: 409,
        });
      }
      if (typeof body.name !== "string") {
        return reply.status(400).send({ error: "Missing name", statusCode: 400 });
      }

      const device: DeviceKind = body.device === "desktop" ? "desktop" : "phone";

      const retryAfterMs = ctx.sessionStore.loginGuard.ipRetryAfterMs(request.ip);
      if (retryAfterMs > 0) {
        return reply
          .status(429)
          .header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
          .send({ error: "Too many attempts", statusCode: 429 });
      }

      let authorized = false;
      let invite: Invite | null = null;
      if (typeof body.qrToken === "string" && body.qrToken.length > 0) {
        authorized = verifyQrToken(session, body.qrToken);
      } else if (typeof body.code === "string" && body.code.length > 0) {
        authorized = ctx.sessionStore.loginCodes.matches(session.id, body.code);
        if (!authorized) {
          const candidate = ctx.sessionStore.invites.get(body.code);
          if (candidate && candidate.sessionId === session.id) {
            const inviteRetryAfterMs = ctx.sessionStore.invites.attemptRetryAfterMs(
              candidate.code,
            );
            if (inviteRetryAfterMs > 0) {
              return reply
                .status(429)
                .header("Retry-After", String(Math.ceil(inviteRetryAfterMs / 1000)))
                .send({ error: "Too many attempts", statusCode: 429 });
            }
            ctx.sessionStore.invites.recordAttempt(candidate.code);
            if (ctx.sessionStore.invites.state(candidate) === "valid") {
              authorized = true;
              invite = candidate;
            }
          }
        }
      }

      if (!authorized) {
        ctx.sessionStore.loginGuard.recordIpFailure(request.ip);
        if (typeof body.code === "string" && body.code.length > 0) {
          ctx.sessionStore.loginGuard.recordSessionFailure(session.id, (sessionId) =>
            ctx.sessionStore.loginCodes.issue(sessionId),
          );
        }
        return reply.status(401).send({
          error: "Invalid session credential",
          statusCode: 401,
        });
      }

      const result = ctx.participantService.join(session, body.name, device);

      if (!result.ok) {
        switch (result.reason) {
          case "INVALID_NAME":
            return reply.status(400).send({ error: "Invalid name", statusCode: 400 });
          case "SESSION_FULL":
            return reply.status(409).send({
              error: "Session is full",
              code: "SESSION_FULL",
              statusCode: 409,
            });
          case "CLOSED":
            return reply.status(410).send({ error: "Session is closed", statusCode: 410 });
          case "WRONG_MODE":
          default:
            return reply.status(409).send({
              error: "Session does not accept participants",
              code: "WRONG_MODE",
              statusCode: 409,
            });
        }
      }

      ctx.sessionStore.loginGuard.recordSessionSuccess(session.id);

      if (invite) {
        ctx.sessionStore.invites.consume(invite, null);
        ctx.sessionStore.notifyHost(session.id, {
          type: "invite:used",
          code: invite.code,
          mode: invite.mode,
          state: ctx.sessionStore.invites.state(invite),
        });
      }

      return reply.status(201).send({
        sessionId: session.id,
        mode: sessionMode(session),
        participant: {
          id: result.participant.id,
          name: result.participant.name,
          device: result.participant.device,
        },
        credential: result.credential,
      });
    },
  );
}
