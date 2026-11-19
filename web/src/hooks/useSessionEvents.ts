import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyConnection, subscribeSession, type SessionEvent, type SessionRole,
} from "../lib/sessionConnection.ts";

export type { SessionRole };

export interface UseSessionEventsOptions {
  role?: SessionRole;
  reconnectInterval?: number;
  onSessionClosed?: (reason: string) => void;
  onEvent?: (event: SessionEvent) => void;
}

export function useSessionEvents(
  sessionId: string | null,
  token: string | null,
  options?: UseSessionEventsOptions,
) {
  const role = options?.role ?? "host";
  const reconnectDelay = options?.reconnectInterval ?? 2000;
  const callbacks = useRef(options);
  callbacks.current = options;
  const subscription = useRef<ReturnType<typeof subscribeSession> | null>(null);
  const [state, setState] = useState(emptyConnection);

  useEffect(() => {
    setState(emptyConnection);
    if (!sessionId || !token) return;
    let lastReason: string | null = null;
    const current = subscribeSession(sessionId, token, role, reconnectDelay, (snapshot, event) => {
      setState(snapshot);
      if (event) callbacks.current?.onEvent?.(event);
      if (snapshot.closedReason && snapshot.closedReason !== lastReason) {
        lastReason = snapshot.closedReason;
        callbacks.current?.onSessionClosed?.(lastReason);
      }
    });
    subscription.current = current;
    return () => {
      current.unsubscribe();
      subscription.current = null;
    };
  }, [sessionId, token, role, reconnectDelay]);

  const sendClose = useCallback(() => subscription.current?.sendClose(), []);
  return {
    files: state.files, sessionInfo: state.sessionInfo,
    connected: state.connected, reconnecting: state.reconnecting,
    closedReason: state.closedReason, sessionClosed: state.closedReason !== null, sendClose,
  };
}
