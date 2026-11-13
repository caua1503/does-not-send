import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
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
    // index.html must always be revalidated: it points at hashed bundles, and a
    // cached shell keeps serving an old build after a rebuild.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  });

  // Vite emits relative "./assets/" URLs (needed by the admin shell). Served
  // from a nested route like /enviar/<id> they would resolve to
  // /enviar/assets/... and hit the SPA fallback as HTML, leaving a blank page.
  // Read per request so a rebuild propagates without restarting the server.
  const readSpaIndex = () =>
    readFileSync(resolve(distPath, "index.html"), "utf8").replace(
      /((?:src|href)=")\.\/assets\//g,
      "$1/assets/",
    );

  // SPA fallback for frontend paths
  app.setNotFoundHandler(async (request, reply) => {
    // API and health 404s stay JSON; /admin/api never falls back to the app SPA
    if (
      request.url.startsWith("/api") ||
      request.url.startsWith("/health") ||
      request.url === "/admin" ||
      request.url.startsWith("/admin/")
    ) {
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    }

    // Direct browser navigation (HTML) receives index.html
    return reply
      .header("Cache-Control", "no-cache")
      .type("text/html")
      .send(readSpaIndex());
  });
}
