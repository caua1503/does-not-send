import { useEffect } from "react";
import { heartbeat } from "../lib/api.ts";

const INTERVAL_MS = 10_000;

/**
 * Sends periodic heartbeats (HTTP backup) to keep the session alive.
 * Clears the interval on unmount.
 */
export function useHeartbeat(sessionId: string | null, token: string | null): void {
  useEffect(() => {
    if (!sessionId || !token) return;

    const id = setInterval(() => {
      heartbeat(sessionId, token).catch(() => {
        // heartbeat failure is non-fatal — session may have expired
      });
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, [sessionId, token]);
}
