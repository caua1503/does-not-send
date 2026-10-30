import { useEffect } from "react";
import { heartbeat } from "../lib/api.ts";

const INTERVAL_MS = 30_000;

/**
 * Sends periodic heartbeats to keep the session alive.
 * Clears the interval on unmount.
 */
export function useHeartbeat(sessionId: string | null, ownerToken: string | null): void {
  useEffect(() => {
    if (!sessionId || !ownerToken) return;

    const id = setInterval(() => {
      heartbeat(sessionId, ownerToken).catch(() => {
        // heartbeat failure is non-fatal — session may have expired
      });
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, [sessionId, ownerToken]);
}
