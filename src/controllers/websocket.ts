import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import type { SessionRole } from "../session/auth.js";
import { fileEvents, type FileEvent, type FileEventType } from "../utils/events.js";

const WS_CLOSE_SESSION_CLOSED = 4000;
const WS_CLOSE_UNAUTHORIZED = 4001;

const EVENT_TYPES: FileEventType[] = ["file:state-changed", "file:progress"];

export async function websocketRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  app.get<{ Params: { id: string } }>(
    "/sessions/:id/ws",
    { websocket: true },
    (socket, request) => {
      const sessionId = request.params.id;

      const session = ctx.sessionStore.getById(sessionId);
      if (!session) {
        socket.close(WS_CLOSE_UNAUTHORIZED, "Session not found");
        return;
      }

      if (session.state === "CLOSED") {
        socket.close(WS_CLOSE_SESSION_CLOSED, "Session closed");
        return;
      }

      // Initially register as pending authentication
      ctx.sessionStore.registerPendingWs(sessionId, socket);

      let authenticatedRole: SessionRole | null = null;
      let eventHandlers: Array<{ type: FileEventType; handler: (event: FileEvent) => void }> = [];

      function cleanup(): void {
        ctx.sessionStore.unregisterWs(sessionId, socket, authenticatedRole);
        for (const { type, handler } of eventHandlers) {
          fileEvents.offFileEvent(type, sessionId, handler);
        }
        eventHandlers = [];
      }

      socket.on("message", async (rawData) => {
        try {
          const msg = JSON.parse(rawData.toString());

          // 1. Unauthenticated state: first message MUST be auth
          if (!authenticatedRole) {
            if (
              msg.type !== "auth" ||
              (msg.role !== "phone" && msg.role !== "computer") ||
              typeof msg.secret !== "string"
            ) {
              socket.close(WS_CLOSE_UNAUTHORIZED, "Invalid auth message");
              return;
            }

            const result = ctx.sessionStore.authenticateWs(
              sessionId,
              msg.role,
              msg.secret,
              socket,
            );

            if (!result.ok) {
              socket.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
              return;
            }

            authenticatedRole = msg.role;

            // Register file event forwarding for computer role
            if (authenticatedRole === "computer") {
              eventHandlers = EVENT_TYPES.map((type) => {
                const handler = (event: FileEvent): void => {
                  if (socket.readyState === socket.OPEN) {
                    socket.send(JSON.stringify(event));
                  }
                };
                fileEvents.onFileEvent(type, sessionId, handler);
                return { type, handler };
              });
            }

            // Acknowledge auth
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "auth_ok", role: authenticatedRole }));
            }
            return;
          }

          // 2. Authenticated messages
          if (msg.type === "heartbeat") {
            ctx.sessionStore.recordHeartbeat(sessionId, authenticatedRole);
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "heartbeat_ack" }));
            }
            return;
          }

          if (msg.type === "close" && authenticatedRole === "computer") {
            await ctx.sessionStore.closeSession(sessionId, "user_closed");
            return;
          }
        } catch {
          if (!authenticatedRole) {
            socket.close(WS_CLOSE_UNAUTHORIZED, "Invalid JSON");
          }
        }
      });

      socket.on("close", cleanup);
      socket.on("error", () => {
        cleanup();
        socket.close();
      });
    },
  );
}
