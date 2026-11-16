import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../app.js";
import type { InviteMode } from "../session/invites.js";
import { authorize } from "./sessions.js";

const MAX_DEVICE_ID_LENGTH = 200;

function isInviteMode(value: unknown): value is InviteMode {
  return value === "single" || value === "multi";
}

function deviceIdFrom(request: FastifyRequest): string | null {
  const body = request.body as { deviceId?: unknown } | undefined;
  const raw =
    typeof body?.deviceId === "string"
      ? body.deviceId
      : request.headers["x-device-id"];
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DEVICE_ID_LENGTH
    ? trimmed
    : null;
}

function inviteUrl(ctx: AppContext, code: string): string {
  return `${ctx.config.publicBaseUrl.replace(/\/+$/, "")}/i/${code}`;
}

export async function inviteRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  // Create an invite link (host only).
  app.post<{
    Params: { id: string };
    Body: { mode?: unknown } | undefined;
  }>("/sessions/:id/invites", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, [
      "owner",
      "computer",
    ]);
    if (!auth) return;

    const mode = request.body?.mode;
    if (!isInviteMode(mode)) {
      return reply.status(400).send({ error: "Invalid mode", statusCode: 400 });
    }

    const session = ctx.sessionStore.getById(auth.sessionId);
    if (!session || session.state === "CLOSED") {
      return reply.status(410).send({ error: "Session is closed", statusCode: 410 });
    }

    const invite = ctx.sessionStore.invites.create(session.id, mode);
    return reply.status(201).send({
      code: invite.code,
      url: inviteUrl(ctx, invite.code),
    });
  });

  // Revoke an invite link (host only, idempotent).
  app.delete<{ Params: { id: string; code: string } }>(
    "/sessions/:id/invites/:code",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, [
        "owner",
        "computer",
      ]);
      if (!auth) return;

      const session = ctx.sessionStore.getById(auth.sessionId);
      if (!session) {
        return reply.status(404).send({ error: "Session not found", statusCode: 404 });
      }
      if (session.state === "CLOSED") {
        return reply.status(410).send({ error: "Session is closed", statusCode: 410 });
      }

      const revoked = ctx.sessionStore.invites.revoke(session.id, request.params.code);
      if (!revoked) {
        return reply.status(404).send({ error: "Invite not found", statusCode: 404 });
      }
      return reply.status(204).send();
    },
  );

  // Inspect an invite without consuming it.
  app.get<{ Params: { code: string } }>("/invites/:code", async (request, reply) => {
    const invite = ctx.sessionStore.invites.get(request.params.code);
    if (!invite) {
      return reply.status(404).send({ error: "Invite not found", statusCode: 404 });
    }
    return reply.status(200).send({ state: ctx.sessionStore.invites.state(invite) });
  });

  // Redeem an invite and hand out the session guest credential.
  app.post<{
    Params: { code: string };
    Body: { deviceId?: unknown } | undefined;
  }>("/invites/:code/redeem", async (request, reply) => {
    const retryAfterMs = ctx.sessionStore.loginGuard.ipRetryAfterMs(request.ip);
    if (retryAfterMs > 0) {
      return reply
        .status(429)
        .header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
        .send({ error: "Too many attempts", statusCode: 429 });
    }

    const invite = ctx.sessionStore.invites.get(request.params.code);
    if (!invite) {
      ctx.sessionStore.loginGuard.recordIpFailure(request.ip);
      return reply.status(404).send({ error: "Invite not found", statusCode: 404 });
    }

    const inviteRetryAfterMs = ctx.sessionStore.invites.attemptRetryAfterMs(invite.code);
    if (inviteRetryAfterMs > 0) {
      return reply
        .status(429)
        .header("Retry-After", String(Math.ceil(inviteRetryAfterMs / 1000)))
        .send({ error: "Too many attempts", statusCode: 429 });
    }
    ctx.sessionStore.invites.recordAttempt(invite.code);

    const deviceId = deviceIdFrom(request);
    const state = ctx.sessionStore.invites.state(invite);
    const sameDevice = state === "used" && deviceId !== null && invite.usedBy === deviceId;
    if (state !== "valid" && !sameDevice) {
      ctx.sessionStore.loginGuard.recordIpFailure(request.ip);
      return reply.status(410).send({
        error: `Invite is ${state}`,
        code: state.toUpperCase(),
        statusCode: 410,
      });
    }

    const session = ctx.sessionStore.getById(invite.sessionId);
    if (!session || session.state === "CLOSED") {
      return reply.status(410).send({
        error: "Session is closed",
        code: "CLOSED",
        statusCode: 410,
      });
    }

    ctx.sessionStore.invites.consume(invite, deviceId);
    const issued = ctx.sessionService.issueGuestCredential(session.id);
    if (!issued) {
      return reply.status(410).send({
        error: "Session is closed",
        code: "CLOSED",
        statusCode: 410,
      });
    }

    return reply.status(200).send({
      success: true,
      phoneCredential: issued.guestCredential,
      visualId: session.visualId,
      shortId: session.visualId,
      state: session.state,
      pairedAt: issued.pairedAt,
    });
  });
}
