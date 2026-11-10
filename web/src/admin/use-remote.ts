import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError } from "../../../src/shared/admin/client.ts";

export type RemoteState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; error: AdminApiError; data?: T };

/**
 * Runs a fetcher whenever `deps` change, cancelling the previous request.
 * `reload` ignores the deps cache (refresh button / retry) and keeps the last
 * good data on screen while the new request is in flight.
 */
export function useRemote<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): RemoteState<T> & { reload: () => void } {
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      status: "loading",
      ...(previous.data !== undefined ? { data: previous.data } : {}),
    }));
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        // Caller aborts are control flow (navigation); a timeout is a real error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const error =
          err instanceof AdminApiError
            ? err
            : new AdminApiError({ status: 0, code: "unknown", message: "Erro inesperado" });
        setState((previous) => ({
          status: "error",
          error,
          ...(previous.data !== undefined ? { data: previous.data } : {}),
        }));
      },
    );
    return () => controller.abort();
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
