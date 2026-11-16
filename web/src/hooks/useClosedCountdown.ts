import { useCallback, useEffect, useRef, useState } from "react";

export const CLOSED_COUNTDOWN_SECONDS = 10;

/** Counts down after the room closes and calls `onElapsed` once at zero. */
export function useClosedCountdown(active: boolean, onElapsed: () => void) {
  const [seconds, setSeconds] = useState(CLOSED_COUNTDOWN_SECONDS);
  const [announcement, setAnnouncement] = useState("");
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;
  const firedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancel = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    firedRef.current = true;
  }, []);

  useEffect(() => {
    if (!active) return;
    firedRef.current = false;
    setSeconds(CLOSED_COUNTDOWN_SECONDS);
    setAnnouncement(`Voltando para o início em ${CLOSED_COUNTDOWN_SECONDS} segundos.`);

    const id = setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    intervalRef.current = id;

    return () => {
      clearInterval(id);
      intervalRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active || seconds > 0 || firedRef.current) return;
    firedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    onElapsedRef.current();
  }, [active, seconds]);

  useEffect(() => {
    if (!active) return;
    if (seconds === CLOSED_COUNTDOWN_SECONDS || seconds === 3) {
      setAnnouncement(`Voltando para o início em ${seconds} segundos.`);
    }
  }, [active, seconds]);

  return { seconds, announcement, cancel };
}
