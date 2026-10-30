import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { AppContext } from "../app.js";
import { authorize } from "./sessions.js";

export async function fileRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { ctx } = opts;

  await app.register(multipart, {
    limits: {
      fileSize: ctx.config.maxFileSize,
      files: ctx.config.maxFilesPerSession,
    },
  });

  // Upload files (upload token)
  app.post<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["upload"]);
    if (!auth) return;

    ctx.sessionService.touchActivity(auth.sessionId);

    const parts = request.parts();
    const results: Array<{ id: string; originalName: string; size: number }> = [];

    for await (const part of parts) {
      if (part.type !== "file") continue;

      try {
        const result = await ctx.fileService.handleFileUpload(
          auth.sessionId,
          part.filename,
          part.mimetype,
          part.file,
          undefined,
        );

        results.push({
          id: result.file.id,
          originalName: result.file.originalName,
          size: result.file.size,
        });
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        if (error.statusCode === 413) {
          return reply.status(413).send({
            error: error.message,
            statusCode: 413,
          });
        }
        throw err;
      }
    }

    return reply.status(201).send({ files: results });
  });

  // List files (owner only)
  app.get<{ Params: { id: string } }>("/sessions/:id/files", async (request, reply) => {
    const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
    if (!auth) return;

    const session = ctx.sessionRepository.getById(auth.sessionId)!;
    return {
      files: session.files.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        bytesReceived: f.bytesReceived,
        state: f.state,
        createdAt: f.createdAt,
      })),
    };
  });

  // Download file (owner only)
  app.get<{ Params: { id: string; fileId: string } }>(
    "/sessions/:id/files/:fileId",
    async (request, reply) => {
      const auth = await authorize(request, reply, ctx, request.params.id, ["owner"]);
      if (!auth) return;

      const session = ctx.sessionRepository.getById(auth.sessionId)!;
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
