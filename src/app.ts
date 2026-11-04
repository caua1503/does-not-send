import type { Writable } from "node:stream";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
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
import { SessionStore } from "./session/store.js";
import { SessionService } from "./services/session-service.js";
import { FileService } from "./services/file-service.js";
import { cleanOrphans } from "./services/cleanup-service.js";
import { type Clock, SystemClock } from "./session/clock.js";
import { createDbClient, type DbClient } from "./db/client.js";
import { MigrationRunner } from "./db/migrate.js";

const MAX_LOGGED_URL_LENGTH = 2048;

/** Query strings carry qrToken/token, and request headers carry Authorization,
 *  so only the path (clipped) is ever logged. */
function loggablePath(request: FastifyRequest): string {
  const queryIndex = request.url.indexOf("?");
  const path = queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
  return path.length > MAX_LOGGED_URL_LENGTH ? path.slice(0, MAX_LOGGED_URL_LENGTH) : path;
}

function loggableError(
  error: unknown,
): { name: string; message: string; code?: string } | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" ? { code } : {}),
  };
}

class RedactedLogController extends LogController {
  override incomingRequest(request: FastifyRequest): void {
    request.log.info(
      { req: { method: request.method, url: loggablePath(request) } },
      "incoming request",
    );
  }

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    _reply: FastifyReply,
  ): void {
    if (error) {
      request.log.error({ err: loggableError(error) }, "request errored");
      return;
    }
    request.log.info(
      { req: { method: request.method, url: loggablePath(request) } },
      "request completed",
    );
  }

  override defaultErrorLog(error: Error, request: FastifyRequest): void {
    request.log.error(
      { req: { method: request.method, url: loggablePath(request) }, err: loggableError(error) },
      "request errored",
    );
  }

  override streamError(error: Error, request: FastifyRequest): void {
    request.log.warn({ err: loggableError(error) }, "response stream error");
  }

  override routeNotFound(request: FastifyRequest): void {
    request.log.info(
      { req: { method: request.method, url: loggablePath(request) } },
      "route not found",
    );
  }

  override writeHeadError(error: Error, request: FastifyRequest): void {
    request.log.warn({ err: loggableError(error) }, "failed to write error response headers");
  }

  override serializerError(error: Error, request: FastifyRequest, _reply: FastifyReply): void {
    request.log.error({ err: loggableError(error) }, "response serializer failed");
  }
}

export interface AppContext {
  config: Config;
  clock: Clock;
  store: SessionStore;
  sessionStore: SessionStore;
  sessionRepository: SessionStore;
  sessionService: SessionService;
  fileService: FileService;
  db?: DbClient & { isReady(): boolean };
  migrationRunner?: MigrationRunner;
}

export interface BuildAppOptions {
  clock?: Clock;
  startSweeper?: boolean;
  sweeperInterval?: number;
  loggerStream?: Writable;
}

export async function buildApp(
  config: Config,
  options?: BuildAppOptions,
): Promise<FastifyInstance> {
  const clock = options?.clock ?? new SystemClock();

  const app = Fastify({
    logger: {
      level: "info",
      transport: undefined, // structured JSON to stdout
      stream: options?.loggerStream,
    },
    logController: new RedactedLogController(),
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
  const sessionStore = new SessionStore({
    clock,
    tempDir: config.tempDir,
    sessionIdleTimeout: config.sessionIdleTimeout,
    timingConfig: {
      heartbeatTimeoutMs: config.heartbeatTimeoutMs,
      computerGraceMs: config.computerGraceMs,
      phoneGraceMs: config.phoneGraceMs,
      wsAuthTimeoutMs: config.wsAuthTimeoutMs,
    },
    cleanupRetry: {
      maxAttempts: config.cleanupMaxAttempts,
      initialDelayMs: config.cleanupInitialDelayMs,
    },
    logger: app.log,
  });
  const sessionService = new SessionService(sessionStore, config, clock);
  const fileService = new FileService(config, sessionStore);

  let db: (DbClient & { isReady(): boolean }) | undefined;
  let migrationRunner: MigrationRunner | undefined;

  // Database is best-effort: a slow or down database must never block boot,
  // requests or file transfers.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const client = createDbClient(databaseUrl);
      db = { ...client, isReady: () => migrationRunner?.isReady() ?? false };
      migrationRunner = new MigrationRunner(databaseUrl, {
        logger: {
          info: (msg) => app.log.info(msg),
          error: (msg) => app.log.error(msg),
        },
      });
      migrationRunner.start();
    } catch {
      // Invalid URL or client construction failure: keep running without a DB.
      db = undefined;
      migrationRunner = undefined;
    }
  }

  const ctx: AppContext = {
    config,
    clock,
    store: sessionStore,
    sessionStore,
    sessionRepository: sessionStore,
    sessionService,
    fileService,
    db,
    migrationRunner,
  };

  if (options?.startSweeper ?? true) {
    sessionStore.startSweeper(options?.sweeperInterval ?? 1000);
  }

  app.addHook("onClose", async () => {
    sessionStore.shutdown();
    // Runner first: it owns its own connection and must stop opening new ones.
    if (migrationRunner) await migrationRunner.stop();
    if (db) await db.close();
  });

  // Clean orphan files from previous runs
  await cleanOrphans(config.tempDir, sessionStore);

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
