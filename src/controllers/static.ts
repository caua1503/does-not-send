import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function staticRoutes(app: FastifyInstance): Promise<void> {
  const distPath = resolve(__dirname, "../../web/dist");

  if (!existsSync(distPath)) {
    return;
  }

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: "/",
  });

  // SPA fallback for frontend paths
  app.setNotFoundHandler(async (request, reply) => {
    // API and health 404s stay JSON
    if (request.url.startsWith("/api") || request.url.startsWith("/health")) {
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    }

    // Direct browser navigation (HTML) receives index.html
    return reply.sendFile("index.html");
  });
}
