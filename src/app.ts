import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { type Config } from "./utils/config.js";
import { errorHandler } from "./utils/error-handler.js";
import { healthRoute } from "./controllers/health.js";
import { sessionRoutes } from "./controllers/sessions.js";
import { fileRoutes } from "./controllers/files.js";
import { downloadRoutes } from "./controllers/download.js";
import { websocketRoutes } from "./controllers/websocket.js";
import { staticRoutes } from "./controllers/static.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { SessionService } from "./services/session-service.js";
import { FileService } from "./services/file-service.js";
import { cleanOrphans } from "./services/cleanup-service.js";

export interface AppContext {
  config: Config;
  sessionRepository: SessionRepository;
  sessionService: SessionService;
  fileService: FileService;
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      transport: undefined, // structured JSON to stdout
    },
    bodyLimit: 1048576, // 1MB for JSON bodies only; multipart handled separately
  });

  // CORS
  await app.register(cors, {
    origin: config.allowedOrigins.includes("*") ? true : config.allowedOrigins,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // WebSocket support
  await app.register(websocket);

  // Security headers
  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("X-Frame-Options", "DENY");
    void reply.header("X-XSS-Protection", "0");
    // Allow per-route override of CSP (e.g., preview uses "sandbox")
    if (!reply.hasHeader("Content-Security-Policy")) {
      const isApiOrHealth = request.url.startsWith("/api") || request.url.startsWith("/health");
      if (isApiOrHealth) {
        void reply.header("Content-Security-Policy", "default-src 'none'");
      } else {
        void reply.header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
      }
    }
    void reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Services
  const sessionRepository = new SessionRepository();
  const sessionService = new SessionService(sessionRepository, config);
  const fileService = new FileService(config, sessionRepository);

  const ctx: AppContext = {
    config,
    sessionRepository,
    sessionService,
    fileService,
  };

  // Clean orphan files from previous runs
  await cleanOrphans(config.tempDir, sessionRepository);

  // Routes
  await app.register(healthRoute);
  await app.register(sessionRoutes, { prefix: "/api", ctx });
  await app.register(fileRoutes, { prefix: "/api", ctx });
  await app.register(downloadRoutes, { prefix: "/api", ctx });
  await app.register(websocketRoutes, { prefix: "/api", ctx });
  await app.register(staticRoutes);

  // Decorate for access in tests
  app.decorate("ctx", ctx);

  return app;
}
