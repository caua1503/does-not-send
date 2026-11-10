import { useEffect, useState } from "react";
import type { AdminFilters } from "../../../src/shared/admin/types.ts";
import { writeFilterParams } from "./filter-url.ts";

export type AdminRoute =
  | { name: "dashboard"; query: URLSearchParams }
  | { name: "sessions"; query: URLSearchParams }
  | { name: "transfers"; query: URLSearchParams }
  | { name: "session"; id: string }
  | { name: "transfer"; id: string }
  | { name: "unknown" };

/** Hash routing (the server only knows /admin; everything else is client-side). */
export function parseHash(hash: string): AdminRoute {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "", search = ""] = raw.split("?", 2);
  const query = new URLSearchParams(search);
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { name: "dashboard", query };
  if (segments.length === 1 && segments[0] === "sessions") return { name: "sessions", query };
  if (segments.length === 1 && segments[0] === "transfers") return { name: "transfers", query };
  if (segments.length === 2 && segments[0] === "sessions") {
    return { name: "session", id: decodeURIComponent(segments[1]!) };
  }
  if (segments.length === 2 && segments[0] === "transfers") {
    return { name: "transfer", id: decodeURIComponent(segments[1]!) };
  }
  return { name: "unknown" };
}

export function useHashRoute(): AdminRoute {
  const [route, setRoute] = useState<AdminRoute>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function hrefFor(route: { path: string; query?: URLSearchParams | string }): string {
  const query = route.query instanceof URLSearchParams ? route.query.toString() : route.query;
  return `#${route.path}${query ? `?${query}` : ""}`;
}

/** Keeps the from/to/ip/session filters when moving between dashboard and lists. */
export function carryFilters(source: AdminFilters, page = 1): URLSearchParams {
  const params = new URLSearchParams();
  writeFilterParams(params, { ...source, page });
  for (const key of ["page", "pageSize", "granularity"]) params.delete(key);
  if (page > 1) params.set("page", String(page));
  return params;
}
