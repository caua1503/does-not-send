import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { safeCompare } from "../utils/safe-compare.js";
import { fileEvents, type FileEvent, type FileEventType } from "../utils/events.js";

/** Close codes */
const WS_CLOSE_SESSION_CLOSED = 4000;
const WS_CLOSE_UNAUTHORIZED = 4001;

const EVENT_TYPES: FileEventType[] = ["file:state-changed", "file:progress"];

export async function websocketRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { ctx } = opts;

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/sessions/:id/ws",
    { websocket: true },
    (socket, request) => {
      const sessionId = request.params.id;
      const token = request.query.token ?? "";

      // Authenticate: owner token only
      const session = ctx.sessionRepository.getById(sessionId);
      const isValid =
        session && session.state === "active" && safeCompare(token, session.ownerToken);

      if (!isValid) {
        // Constant-time dummy compare to avoid timing leak when no session
        if (!session) safeCompare(token, "0".repeat(64));
        socket.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        return;
      }

      // Send file event to this socket
      function send(event: FileEvent): void {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      }

      // Register per-session listeners
      const handlers = EVENT_TYPES.map((type) => {
        const handler = (event: FileEvent): void => send(event);
        fileEvents.onFileEvent(type, sessionId, handler);
        return { type, handler };
      });

      // Listen for session close event from SessionService
      function onSessionClosed(closedId: string): void {
        if (closedId !== sessionId) return;
        socket.close(WS_CLOSE_SESSION_CLOSED, "Session closed");
      }
      fileEvents.on("session:closed", onSessionClosed);

      // Cleanup on disconnect
      function cleanup(): void {
        for (const { type, handler } of handlers) {
          fileEvents.offFileEvent(type, sessionId, handler);
        }
        fileEvents.off("session:closed", onSessionClosed);
      }

      socket.on("close", cleanup);
      socket.on("error", () => {
        cleanup();
        socket.close();
      });
    },
  );
}
