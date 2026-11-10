import type { AdminFilters, Category, Granularity, TransferStatus } from "../../../src/shared/admin/types.ts";
import { GRANULARITIES, CATEGORIES } from "../../../src/shared/admin/types.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  TRANSFER_STATUSES,
} from "../../../src/shared/admin/filters.ts";

/**
 * Filters live in the URL query string (shareable, survives refresh/back).
 * Values are re-validated here so a hand-edited URL cannot smuggle anything
 * through: the backend validates again, but the UI must not choke on it either.
 */

const MAX_TEXT = 100;

function text(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value.slice(0, MAX_TEXT) : undefined;
}

function int(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function oneOf<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const value = params.get(key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parseFilterParams(params: URLSearchParams): AdminFilters {
  const granularity: Granularity = oneOf(params, "granularity", GRANULARITIES) ?? "day";
  const pageSize = int(params, "pageSize");
  const filters: AdminFilters = {
    page: Math.max(1, int(params, "page") ?? 1),
    pageSize: pageSize && pageSize <= MAX_PAGE_SIZE ? pageSize : DEFAULT_PAGE_SIZE,
    granularity,
  };
  const from = text(params, "from");
  const to = text(params, "to");
  const ip = text(params, "ip");
  const session = text(params, "session");
  const q = text(params, "q");
  const category = oneOf<Category>(params, "category", CATEGORIES);
  const status = oneOf<TransferStatus>(params, "status", TRANSFER_STATUSES);
  const minSize = int(params, "minSize");
  const maxSize = int(params, "maxSize");
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (ip) filters.ip = ip;
  if (session) filters.session = session;
  if (q) filters.q = q;
  if (category) filters.category = category;
  if (status) filters.status = status;
  if (minSize !== undefined) filters.minSize = minSize;
  if (maxSize !== undefined) filters.maxSize = maxSize;
  return filters;
}

/** Writes filters into params, dropping defaults so URLs stay short. */
export function writeFilterParams(params: URLSearchParams, filters: AdminFilters): URLSearchParams {
  for (const key of [...params.keys()]) {
    if (key !== "sort" && key !== "dir") params.delete(key);
  }
  const keep = <T>(current: T | undefined, fallback: T, key: string): void => {
    if (current !== undefined && current !== fallback) params.set(key, String(current));
  };
  keep(filters.from, undefined, "from");
  keep(filters.to, undefined, "to");
  keep(filters.ip, undefined, "ip");
  keep(filters.session, undefined, "session");
  keep(filters.q, undefined, "q");
  keep(filters.category, undefined, "category");
  keep(filters.status, undefined, "status");
  keep(filters.minSize, undefined, "minSize");
  keep(filters.maxSize, undefined, "maxSize");
  keep(filters.page, 1, "page");
  keep(filters.pageSize, DEFAULT_PAGE_SIZE, "pageSize");
  keep(filters.granularity, "day", "granularity");
  return params;
}

export function readListSort(
  params: URLSearchParams,
  allowed: readonly string[],
  fallback: string,
): { sort: string; dir: "asc" | "desc" } {
  const sort = params.get("sort");
  return {
    sort: sort && allowed.includes(sort) ? sort : fallback,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
  };
}

/** Explicit bounds win; a missing side keeps the default 30-day window. */
/** Fields that change which rows a list/summary request returns. */
export function filterKey(filters: AdminFilters): string {
  return [
    filters.from,
    filters.to,
    filters.q,
    filters.ip,
    filters.session,
    filters.category,
    filters.status,
    filters.minSize,
    filters.maxSize,
  ].join("\u0000");
}

export function withPeriod(filters: AdminFilters, anchor: string): AdminFilters {
  const from = filters.from ?? shiftDays(anchor, -29);
  const to = filters.to ?? anchor;
  return { ...filters, from, to: from > to ? from : to };
}

function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function hasActiveFilters(filters: AdminFilters): boolean {
  return Boolean(
    filters.from ||
      filters.to ||
      filters.ip ||
      filters.session ||
      filters.q ||
      filters.category ||
      filters.status ||
      filters.minSize !== undefined ||
      filters.maxSize !== undefined,
  );
}
