import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { rm } from "node:fs/promises";
import type { AppContext } from "../app.js";
import { authorize } from "./sessions.js";
import { startUpload, endUpload } from "../session/auth.js";
import { canDelete, canDownload, canUpload, sessionMode } from "../session/permissions.js";
import { itemAddedEvent } from "../session/twoway.js";
import { parseOriginalSize } from "../utils/original-size.js";

function abortOnDisconnect(request: FastifyRequest, controller: AbortController): () => void {
  const raw = request.raw;
  const onClose = () => {
    if (!raw.complete) controller.abort();
  };
  raw.once("close", onClose);
  if (raw.destroyed) onClose();
  return () => raw.off("close", onClose);
}

export async function fileRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { ctx } = opts;

  await app.register(multipart, {
    limits: {
      // Busboy flags a part as truncated as soon as it reaches this threshold.
      fileSize: ctx.config.maxFileSize + 1,
      files: ctx.config.maxFilesPerSession,
    },
  });

  // Upload files (guest credential)
  app.post<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const { id } = request.params;
    const session = ctx.sessionStore.getById(id);

    // 1. Sessão existe?
    if (!session) {
      return reply.status(404).send({ error: "Session not found", statusCode: 404 });
    }

    // 2. Sessão encerrada?
    if (session.state === "CLOSED") {
      return reply.status(410).send({ error: "Session is closed", statusCode: 410 });
    }

    // 3. Credencial válida?
    const auth = await authorize(request, reply, ctx, id, [
      "phone",
      "owner",
      "computer",
    ]);
    if (!auth) return;

    if (!canUpload(session, auth.participant)) {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }

    // 4. Estado é PAIRED ou TRANSFERRING?
    if (session.state !== "PAIRED" && session.state !== "TRANSFERRING") {
      return reply.status(409).send({
        error: `Invalid session state for upload: ${session.state}`,
        code: "INVALID_STATE",
        statusCode: 409,
      });
    }

    // 5. Inicia upload síncrono no domínio
    startUpload(session);
    ctx.sessionService.touchActivity(session.id);

    const kind =
      (request.query as { kind?: unknown } | undefined)?.kind === "text" ? "text" : undefined;

    const abortController = new AbortController();
    const removeDisconnectListener = abortOnDisconnect(request, abortController);
    const unregisterUpload = ctx.sessionStore.registerUploadAbortController(
      session.id,
      abortController,
      auth.participant.id,
    );

    try {
      const parts = request.parts();
      const results: Array<{
        id: string;
        originalName: string;
        size: number;
        kind?: "file" | "text";
      }> = [];
      let rawOriginalSize: unknown;

      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "originalSize") rawOriginalSize = part.value;
          continue;
        }

        try {
          const result = await ctx.fileService.handleFileUpload(
            session.id,
            part.filename,
            part.mimetype,
            part.file,
            undefined,
            abortController.signal,
            kind,
            parseOriginalSize(rawOriginalSize),
          );

          result.file.senderId = auth.participant.id;
          result.file.senderName = auth.participant.name;
          result.file.origin = auth.participant.device;
          ctx.sessionStore.update(session);

          if (sessionMode(session) === "twoway") {
            const event = itemAddedEvent(result.file);
            if (event) ctx.sessionStore.notifyWs(session.id, event);
          }

          results.push({
            id: result.file.id,
            originalName: result.file.originalName,
            size: result.file.size,
            kind: result.file.kind,
          });
        } catch (err) {
          const error = err as Error & { statusCode?: number };
          if (error.statusCode === 400 || error.statusCode === 429) {
            return reply.status(error.statusCode).send({
              error: error.message,
              statusCode: error.statusCode,
            });
          }
          if (error.statusCode === 413 || error.statusCode === 507) {
            return reply.status(error.statusCode).send({
              error: error.message,
              statusCode: error.statusCode,
            });
          }
          if (error.statusCode === 410 || error.statusCode === 499) {
            const closed = error.statusCode === 410 || ctx.sessionStore.getById(session.id)?.state === "CLOSED";
            const statusCode = closed ? 410 : 409;
            return reply.status(statusCode).send({
              error: closed ? "Session closed during upload" : "Upload interrupted",
              code: closed ? "SESSION_CLOSED" : "UPLOAD_INTERRUPTED",
              statusCode,
            });
          }
          throw err;
        }
      }

      return reply.status(201).send({ files: results });
    } finally {
      removeDisconnectListener();
      unregisterUpload();
      endUpload(session);
      ctx.sessionStore.update(session);
    }
  });

  // Replace file content, keeping the same fileId (guest only)
  app.put<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, ["phone"]);
      if (!auth) return;

      const session = ctx.sessionStore.getById(auth.sessionId)!;
      if (session.state !== "PAIRED" && session.state !== "TRANSFERRING") {
        return reply.status(409).send({
          error: `Invalid session state for upload: ${session.state}`,
          code: "INVALID_STATE",
          statusCode: 409,
        });
      }

      startUpload(session);
      ctx.sessionService.touchActivity(session.id);

      const abortController = new AbortController();
      const removeDisconnectListener = abortOnDisconnect(request, abortController);
      const unregisterUpload = ctx.sessionStore.registerUploadAbortController(
        session.id,
        abortController,
        auth.participant.id,
      );

      try {
        let rawOriginalSize: unknown;
        for await (const part of request.parts()) {
          if (part.type === "field") {
            if (part.fieldname === "originalSize") rawOriginalSize = part.value;
            continue;
          }

          try {
            const result = await ctx.fileService.replaceFile(
              session.id,
              request.params.fileId,
              part.filename,
              part.mimetype,
              part.file,
              abortController.signal,
              parseOriginalSize(rawOriginalSize),
            );

            return reply.status(200).send({
              file: {
                id: result.file.id,
                originalName: result.file.originalName,
                mimeType: result.file.mimeType,
                size: result.file.size,
                bytesReceived: result.file.bytesReceived,
                state: result.file.state,
                version: result.file.version,
                finishedAt: result.file.finishedAt,
              },
            });
          } catch (err) {
            const error = err as Error & { statusCode?: number };
            if (
              error.statusCode === 413 ||
              error.statusCode === 507 ||
              error.statusCode === 404 ||
              error.statusCode === 409 ||
              error.statusCode === 400
            ) {
              return reply.status(error.statusCode).send({
                error: error.message,
                statusCode: error.statusCode,
              });
            }
            if (error.statusCode === 410 || error.statusCode === 499) {
              const closed = error.statusCode === 410 || ctx.sessionStore.getById(session.id)?.state === "CLOSED";
              const statusCode = closed ? 410 : 409;
              return reply.status(statusCode).send({
                error: closed ? "Session closed during upload" : "Upload interrupted",
                code: closed ? "SESSION_CLOSED" : "UPLOAD_INTERRUPTED",
                statusCode,
              });
            }
            throw err;
          }
        }

        return reply.status(400).send({ error: "Missing file", statusCode: 400 });
      } finally {
        removeDisconnectListener();
        unregisterUpload();
        endUpload(session);
        ctx.sessionStore.update(session);
      }
    },
  );

  // List files (any member in twoway; host only in oneway)
  app.get<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, [
      "owner",
      "computer",
      "phone",
    ]);
    if (!auth) return;

    const session = ctx.sessionStore.getById(auth.sessionId)!;
    if (!canDownload(session, auth.participant)) {
      const status = sessionMode(session) === "oneway" ? 401 : 403;
      return reply.status(status).send({ error: "Unauthorized", statusCode: status });
    }

    return {
      files: session.files
        .filter((f) => sessionMode(session) !== "twoway" || f.state !== "failed")
        .map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        bytesReceived: f.bytesReceived,
        state: f.state,
        version: f.version,
        createdAt: f.createdAt,
        kind: f.kind,
        senderId: f.senderId,
        senderName: f.senderName,
        origin: f.origin,
      })),
    };
  });
  app.get<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, [
        "owner",
        "computer",
        "phone",
      ]);
      if (!auth) return;

      const session = ctx.sessionStore.getById(auth.sessionId)!;
      if (!canDownload(session, auth.participant)) {
        const status = sessionMode(session) === "oneway" ? 401 : 403;
        return reply.status(status).send({ error: "Unauthorized", statusCode: status });
      }

      const file = session.files.find((f) => f.id === request.params.fileId);

      if (!file || file.state !== "completed") {
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }

      const filePath = ctx.fileService.getFilePath(auth.sessionId, file.storageName);
      const { createReadStream } = await import("node:fs");
      const stream = createReadStream(filePath);

      return reply
        .header("Content-Type", file.mimeType)
        .header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(file.originalName)}"`,
        )
        .header("Content-Length", file.size)
        .send(stream);
    },
  );

  // Delete an item (author or host in twoway)
  app.delete<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, [
        "owner",
        "computer",
        "phone",
      ]);
      if (!auth) return;

      return ctx.fileService.withItemPublication(auth.sessionId, request.params.fileId, async () => {
        const session = ctx.sessionStore.getById(auth.sessionId);
        const file = session?.files.find((f) => f.id === request.params.fileId);
        if (!session || session.state === "CLOSED" || !file) {
          return reply.status(404).send({ error: "File not found", statusCode: 404 });
        }

        if (!canDelete(session, auth.participant, file)) {
          return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
        }

        await rm(ctx.fileService.getFilePath(session.id, file.storageName), {
          force: true,
        });
        session.files = session.files.filter((f) => f.id !== file.id);
        ctx.sessionStore.update(session);

        if (sessionMode(session) === "twoway") {
          ctx.sessionStore.notifyWs(session.id, { type: "item:deleted", id: file.id });
        }

        return reply.status(204).send();
      });
    },
  );
}
