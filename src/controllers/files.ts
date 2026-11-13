import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { AppContext } from "../app.js";
import { authorize } from "./sessions.js";
import {
  authorize as domainAuthorize,
  startUpload,
  endUpload,
} from "../session/auth.js";

export async function fileRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { ctx } = opts;

  await app.register(multipart, {
    limits: {
      fileSize: ctx.config.maxFileSize,
      files: ctx.config.maxFilesPerSession,
    },
  });

  // Upload files (phone credential)
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
    let token: string | undefined;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else if (request.query && typeof (request.query as { token?: unknown }).token === "string") {
      token = (request.query as { token: string }).token;
    }

    if (!token) {
      return reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
    }

    const phoneAuth = domainAuthorize(session, "phone", token);
    const compAuth = domainAuthorize(session, "computer", token);

    if (!phoneAuth.ok && !compAuth.ok) {
      return reply.status(401).send({ error: "Unauthorized", statusCode: 401 });
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
    const unregisterUpload = ctx.sessionStore.registerUploadAbortController(
      session.id,
      abortController,
    );

    try {
      const parts = request.parts();
      const results: Array<{
        id: string;
        originalName: string;
        size: number;
        kind?: "file" | "text";
      }> = [];

      for await (const part of parts) {
        if (part.type !== "file") continue;

        try {
          const result = await ctx.fileService.handleFileUpload(
            session.id,
            part.filename,
            part.mimetype,
            part.file,
            undefined,
            abortController.signal,
            kind,
          );

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
          if (error.statusCode === 413) {
            return reply.status(413).send({
              error: error.message,
              statusCode: 413,
            });
          }
          if (error.statusCode === 410) {
            return reply.status(410).send({
              error: "Session closed during upload",
              statusCode: 410,
            });
          }
          throw err;
        }
      }

      return reply.status(201).send({ files: results });
    } finally {
      unregisterUpload();
      endUpload(session);
      ctx.sessionStore.update(session);
    }
  });

  // Replace file content, keeping the same fileId (phone only)
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
      const unregisterUpload = ctx.sessionStore.registerUploadAbortController(
        session.id,
        abortController,
      );

      try {
        for await (const part of request.parts()) {
          if (part.type !== "file") continue;

          try {
            const result = await ctx.fileService.replaceFile(
              session.id,
              request.params.fileId,
              part.filename,
              part.mimetype,
              part.file,
              abortController.signal,
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
              error.statusCode === 404 ||
              error.statusCode === 400
            ) {
              return reply.status(error.statusCode).send({
                error: error.message,
                statusCode: error.statusCode,
              });
            }
            if (error.statusCode === 410) {
              return reply.status(410).send({
                error: "Session closed during upload",
                statusCode: 410,
              });
            }
            throw err;
          }
        }

        return reply.status(400).send({ error: "Missing file", statusCode: 400 });
      } finally {
        unregisterUpload();
        endUpload(session);
        ctx.sessionStore.update(session);
      }
    },
  );

  // List files (owner only)
  app.get<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer"]);
    if (!auth) return;

    const session = ctx.sessionStore.getById(auth.sessionId)!;
    return {
      files: session.files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        bytesReceived: f.bytesReceived,
        state: f.state,
        version: f.version,
        createdAt: f.createdAt,
        kind: f.kind,
      })),
    };
  });

  // Download file (owner only)
  app.get<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, ["owner", "computer"]);
      if (!auth) return;

      const session = ctx.sessionStore.getById(auth.sessionId)!;
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
}
