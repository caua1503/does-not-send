import { useEffect, useRef } from "react";

export const REFRESH_OPTIONS = [0, 30] as const;
const TICK_MS = 1000;

/** Calls `onTick` once per interval while `hasUnsavedFocus` is false. */
export function useAutoRefresh(
  enabled: boolean,
  intervalSeconds: number,
  onTick: () => void,
  hasUnsavedFocus: boolean,
): void {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  useEffect(() => {
    if (!enabled || intervalSeconds <= 0) return;
    let remaining = intervalSeconds;
    const id = setInterval(() => {
      // Never yank the screen out from under someone typing in a filter.
      if (hasUnsavedFocus) {
        remaining = intervalSeconds;
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        remaining = intervalSeconds;
        tickRef.current();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, intervalSeconds, hasUnsavedFocus]);
}
