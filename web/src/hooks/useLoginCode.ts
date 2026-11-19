import { useEffect, useState, useCallback } from "react";
import { emptyLoginCode, subscribeSession } from "../lib/sessionConnection.ts";
import { remainingSeconds } from "../lib/loginCode.ts";

export function useLoginCode(sessionId: string | null, token: string | null) {
  const [state, setState] = useState(emptyLoginCode);
  useEffect(() => {
    setState(emptyLoginCode);
    if (!sessionId || !token) return;
    return subscribeSession(sessionId, token, "host", 2000, (snapshot) => {
      setState(snapshot.loginCode);
    }).unsubscribe;
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
