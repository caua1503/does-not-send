import { useReducer, useEffect, useRef, useState } from "react";
import { sessionReducer, initialState } from "../lib/sessionReducer.ts";
import { wsUrl } from "../lib/api.ts";
import type { FileEntry } from "../lib/api.ts";

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

interface UseSessionEventsResult {
  files: FileEntry[];
  connected: boolean;
}

/**
 * Subscribes to a session's WebSocket stream.
 * - Applies WS events via sessionReducer
 * - Reconnects with exponential backoff (1s → 30s max)
 * - Stops reconnecting on close code 4000 (session closed)
 * - Cleans up on unmount or sessionId change
 */
export function useSessionEvents(
  sessionId: string | null,
  ownerToken: string | null,
): UseSessionEventsResult {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffStepRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !ownerToken) return;

    let stopped = false;

    function clearRetry() {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    }

    function connect() {
      if (stopped || !mountedRef.current) return;
      clearRetry();

      const url = wsUrl(sessionId!, ownerToken!);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stopped) {
          setConnected(true);
          backoffStepRef.current = 0;
        }
      };

      ws.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          if (
            data.type === "file:state-changed" ||
            data.type === "file:progress"
          ) {
            dispatch(data as Parameters<typeof sessionReducer>[1]);
          }
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = (event) => {
        if (stopped) return;
        setConnected(false);
        wsRef.current = null;

        if (event.code === 4000) {
          // Session was closed server-side — do not reconnect
          return;
        }

        // Schedule reconnect with backoff
        const step = Math.min(backoffStepRef.current, BACKOFF_STEPS.length - 1);
        const delay = BACKOFF_STEPS[step]!;
        backoffStepRef.current = step + 1;

        retryRef.current = setTimeout(() => {
          if (!stopped && mountedRef.current) connect();
        }, delay);
      };

      ws.onerror = () => {
        // onerror is always followed by onclose — let onclose handle it
        if (!stopped) setConnected(false);
      };
    }

    connect();

    return () => {
      stopped = true;
      clearRetry();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [sessionId, ownerToken]);

  return { files: state.files, connected };
}
