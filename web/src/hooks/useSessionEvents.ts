import { useReducer, useEffect, useRef, useState, useCallback } from "react";
import { sessionReducer, initialState } from "../lib/sessionReducer.ts";
import { wsUrl } from "../lib/api.ts";
import type { FileEntry } from "../lib/api.ts";

export type SessionRole = "phone" | "computer";

export interface UseSessionEventsOptions {
  role?: SessionRole;
  reconnectInterval?: number;
  onSessionClosed?: (reason: string) => void;
}

export interface UseSessionEventsResult {
  files: FileEntry[];
  connected: boolean;
  sessionClosed: boolean;
  closedReason: string | null;
  reconnecting: boolean;
  sendClose: () => void;
}

/**
 * Subscribes to a session's WebSocket stream.
 * - Authenticates first: sends {"type":"auth","role": role, "secret": secret}
 * - Sends heartbeat every 10s (10000ms) after authenticated
 * - Applies WS file events via sessionReducer
 * - Reconnects automatically (every 2s for phone or configured interval)
 * - Handles "session_closed" event and code 4000
 * - Cleans up on unmount or sessionId change
 */
export function useSessionEvents(
  sessionId: string | null,
  token: string | null,
  options?: UseSessionEventsOptions,
): UseSessionEventsResult {
  const role = options?.role ?? "computer";
  const reconnectDelay = options?.reconnectInterval ?? (role === "phone" ? 2000 : 2000);

  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const [connected, setConnected] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !token) {
      setConnected(false);
      setReconnecting(false);
      return;
    }

    let stopped = false;

    function clearTimers() {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    }

    function sendHeartbeat(ws: WebSocket) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }

    function connect() {
      if (stopped || !mountedRef.current) return;
      clearTimers();

      try {
        const url = wsUrl(sessionId!, token!);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (stopped) return;
          // 1. Unauthenticated state: first message MUST be auth
          ws.send(
            JSON.stringify({
              type: "auth",
              role,
              secret: token,
            }),
          );
        };

        ws.onmessage = (event) => {
          if (stopped) return;
          try {
            const data = JSON.parse(event.data as string) as Record<string, unknown>;

            if (data.type === "auth_ok") {
              setConnected(true);
              setReconnecting(false);

              // 2. Authenticated: start heartbeat every 10s (10000ms)
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              heartbeatRef.current = setInterval(() => {
                sendHeartbeat(ws);
              }, 10_000);
              return;
            }

            if (data.type === "heartbeat_ack") {
              return;
            }

            if (data.type === "session_closed") {
              const reason = (data.reason as string) || "closed";
              setSessionClosed(true);
              setClosedReason(reason);
              setConnected(false);
              setReconnecting(false);
              stopped = true;
              clearTimers();
              options?.onSessionClosed?.(reason);
              try {
                ws.close(4000, "Session closed");
              } catch {}
              return;
            }

            if (
              data.type === "file:state-changed" ||
              data.type === "file:progress"
            ) {
              dispatch(data as Parameters<typeof sessionReducer>[1]);
            }
          } catch {
            // Malformed message — ignore
          }
        };

        ws.onclose = (event) => {
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
          if (stopped) return;
          setConnected(false);
          wsRef.current = null;

          if (event.code === 4000) {
            // Session closed server-side — do not reconnect
            setSessionClosed(true);
            setReconnecting(false);
            return;
          }

          if (event.code === 4001) {
            // Unauthorized / Auth timeout — do not reconnect
            setConnected(false);
            setReconnecting(false);
            return;
          }

          // Schedule reconnect
          setReconnecting(true);
          retryRef.current = setTimeout(() => {
            if (!stopped && mountedRef.current) connect();
          }, reconnectDelay);
        };

        ws.onerror = () => {
          if (!stopped) setConnected(false);
        };
      } catch {
        if (!stopped && mountedRef.current) {
          setReconnecting(true);
          retryRef.current = setTimeout(connect, reconnectDelay);
        }
      }
    }

    connect();

    return () => {
      stopped = true;
      clearTimers();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      setConnected(false);
      setReconnecting(false);
    };
  }, [sessionId, token, role, reconnectDelay]);

  const sendClose = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "close" }));
    }
  }, []);

  return {
    files: state.files,
    connected,
    sessionClosed,
    closedReason,
    reconnecting,
    sendClose,
  };
}
