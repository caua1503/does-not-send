import { useEffect, useRef, useState, useCallback } from "react";
import { wsUrl } from "../lib/api.ts";
import { remainingSeconds } from "../lib/loginCode.ts";

export interface LoginCodeState {
  code: string | null;
  /** Deadline of the current code (local clock), for the countdown. */
  deadline: number | null;
}

interface LoginCodeMessage {
  type: "login_code";
  sessionId: string;
  code: string;
  expiresInMs: number;
}

/**
 * Keeps the computer's current manual login code, delivered over the same
 * session WebSocket the file events use. Authenticates, then waits for
 * `login_code` pushes (one every rotation); reconnects on its own.
 */
export function useLoginCode(
  sessionId: string | null,
  token: string | null,
): LoginCodeState {
  const [state, setState] = useState<LoginCodeState>({ code: null, deadline: null });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !token) {
      setState({ code: null, deadline: null });
      return;
    }

    let stopped = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (stopped || !mountedRef.current) return;
      ws = new WebSocket(wsUrl(sessionId!, token!));

      ws.onopen = () => {
        if (stopped) return;
        ws!.send(JSON.stringify({ type: "auth", role: "computer", secret: token }));
      };

      ws.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data as string) as { type?: string };
          if (data.type !== "login_code") return;
          const message = data as LoginCodeMessage;
          setState({ code: message.code, deadline: Date.now() + message.expiresInMs });
        } catch {
          // Malformed message — ignore
        }
      };

      ws.onclose = (event) => {
        if (stopped || event.code === 4000) return;
        retry = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
    };
  }, [sessionId, token]);

  return state;
}

/** Countdown seconds ticking once a second until the deadline. */
export function useCountdownSeconds(deadline: number | null): number {
  const compute = useCallback(
    () => (deadline ? remainingSeconds(deadline, Date.now()) : 0),
    [deadline],
  );
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    if (!deadline) return;
    const id = setInterval(() => setSeconds(compute()), 1000);
    return () => clearInterval(id);
  }, [deadline, compute]);

  return seconds;
}
