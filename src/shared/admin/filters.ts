import {
  CATEGORIES,
  type AdminFilters,
  type Category,
  type Granularity,
  type TransferStatus,
  GRANULARITIES,
} from "./types.js";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_GRANULARITY: Granularity = "day";
/** Default period when no from/to is supplied. */
export const DEFAULT_PERIOD_DAYS = 30;
const MAX_TEXT_LENGTH = 100;
const MAX_URL_LENGTH = 2048;

export const TRANSFER_STATUSES: readonly TransferStatus[] = [
  "receiving",
  "completed",
  "failed",
];

export interface ParsedFilters {
  filters: AdminFilters;
  /** Non-fatal problems; each invalid input is dropped and defaulted. */
  warnings: string[];
}

function isTransferStatus(v: string): v is TransferStatus {
  return (TRANSFER_STATUSES as readonly string[]).includes(v);
}

function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

function isGranularity(v: string): v is Granularity {
  return (GRANULARITIES as readonly string[]).includes(v);
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function cleanText(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  // Strip control characters (URL smuggling / terminal injection), then trim.
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code < 0x20 || code === 0x7f);
    })
    .join("")
    .trim();
  if (cleaned === "" || cleaned.length > MAX_TEXT_LENGTH) return undefined;
  return cleaned;
}

function readIso(params: URLSearchParams, key: string, warnings: string[]): string | undefined {
  const value = cleanText(params.get(key));
  if (value === undefined) {
    if (params.get(key) !== null && params.get(key) !== "") warnings.push(key);
    return undefined;
  }
  if (!ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    warnings.push(key);
    return undefined;
  }
  return new Date(Date.parse(value)).toISOString();
}

function readPositiveInt(
  params: URLSearchParams,
  key: string,
  warnings: string[],
  fallback: number,
): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    warnings.push(key);
    return fallback;
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > Number.MAX_SAFE_INTEGER) {
    warnings.push(key);
    return fallback;
  }
  return parsed;
}

function readBytes(params: URLSearchParams, key: string, warnings: string[]): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const value = raw.trim();
  if (!/^\d+$/.test(value) || Number(value) > Number.MAX_SAFE_INTEGER) {
    warnings.push(key);
    return undefined;
  }
  return Number(value);
}

/**
 * Parse admin filters from a query string. Unknown/invalid inputs are dropped
 * (with a warning name) and replaced by defaults, so the endpoint never 500s
 * on user input.
 */
export function parseAdminFilters(input: URLSearchParams | string): ParsedFilters {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const warnings: string[] = [];

  let category: Category | undefined;
  const rawCategory = cleanText(params.get("category"));
  if (rawCategory !== undefined) {
    if (isCategory(rawCategory)) category = rawCategory;
    else warnings.push("category");
  }

  let status: TransferStatus | undefined;
  const rawStatus = cleanText(params.get("status"));
  if (rawStatus !== undefined) {
    if (isTransferStatus(rawStatus)) status = rawStatus;
    else warnings.push("status");
  }

  let granularity: Granularity = DEFAULT_GRANULARITY;
  const rawGranularity = cleanText(params.get("granularity"));
  if (rawGranularity !== undefined) {
    if (isGranularity(rawGranularity)) granularity = rawGranularity;
    else warnings.push("granularity");
  }

  let from = readBound(params, "from", warnings);
  let to = readBound(params, "to", warnings);
  if (from && to && Date.parse(from) > Date.parse(to)) {
    warnings.push("from");
    [from, to] = [to, from];
  }

  let minSize = readBytes(params, "minSize", warnings);
  let maxSize = readBytes(params, "maxSize", warnings);
  if (minSize !== undefined && maxSize !== undefined && minSize > maxSize) {
    warnings.push("minSize");
    [minSize, maxSize] = [maxSize, minSize];
  }

  const page = readPositiveInt(params, "page", warnings, 1);
  let pageSize = readPositiveInt(params, "pageSize", warnings, DEFAULT_PAGE_SIZE);
  if (pageSize > MAX_PAGE_SIZE) {
    warnings.push("pageSize");
    pageSize = MAX_PAGE_SIZE;
  }

  const ip = cleanText(params.get("ip"));
  if (ip === undefined && params.get("ip") !== null) warnings.push("ip");
  const session = cleanText(params.get("session"));
  if (session === undefined && params.get("session") !== null) warnings.push("session");
  const q = cleanText(params.get("q"));
  if (q === undefined && params.get("q") !== null && params.get("q") !== "") warnings.push("q");

  const filters: AdminFilters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(ip ? { ip } : {}),
    ...(session ? { session } : {}),
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(minSize !== undefined ? { minSize } : {}),
    ...(maxSize !== undefined ? { maxSize } : {}),
    ...(q ? { q } : {}),
    page,
    pageSize,
    granularity,
  };

  return { filters, warnings };
}

/** Serialize back to a query string, omitting defaults to keep URLs short. */
export function serializeAdminFilters(filters: AdminFilters): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined): void => {
    if (value !== undefined) params.set(key, String(value));
  };
  set("from", filters.from);
  set("to", filters.to);
  set("ip", filters.ip);
  set("session", filters.session);
  set("category", filters.category);
  set("status", filters.status);
  set("minSize", filters.minSize);
  set("maxSize", filters.maxSize);
  set("q", filters.q);
  if (filters.page !== 1) set("page", filters.page);
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) set("pageSize", filters.pageSize);
  if (filters.granularity !== DEFAULT_GRANULARITY) set("granularity", filters.granularity);
  const s = params.toString();
  return s.length > MAX_URL_LENGTH ? "" : s;
}

export interface Period {
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isPlainDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Y-M-D H:M:S of `date` as seen on a clock in `tz`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** UTC instant of wall-clock `y-m-d 00:00:00` in `tz` (iterates once for DST). */
export function dateTuple(plainDate: string): [number, number, number] {
  const [y, m, d] = plainDate.split("-").map(Number);
  return [y!, m!, d!];
}

/**
 * A bare date is kept as-is ("YYYY-MM-DD"): resolvePeriod turns it into a full
 * day in the admin timezone, so it must not be re-read as UTC midnight here.
 */
function readBound(params: URLSearchParams, key: string, warnings: string[]): string | undefined {
  const value = cleanText(params.get(key));
  if (value !== undefined && isPlainDate(value)) {
    return Number.isNaN(Date.parse(value)) ? (warnings.push(key), undefined) : value;
  }
  return readIso(params, key, warnings);
}

export function startOfDayInZone(year: number, month: number, day: number, tz: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const p = zonedParts(new Date(wallAsUtc), tz);
  const firstOffset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wallAsUtc;
  const instant = wallAsUtc - firstOffset;
  const p2 = zonedParts(new Date(instant), tz);
  const secondOffset = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second) - instant;
  return secondOffset === firstOffset ? instant : wallAsUtc - secondOffset;
}

/**
 * Resolve the effective period: explicit bounds win; a missing `to` is "now";
 * missing `from` defaults to 30 days before `to`. A bare date is read as a
 * calendar day in `tz` (from = 00:00:00.000, to = 23:59:59.999).
 */
export function resolvePeriod(
  bounds: Pick<AdminFilters, "from" | "to">,
  now: Date,
  tz: string = "America/Sao_Paulo",
): Period {
  let fromMs: number;
  let toMs: number;

  if (bounds.to && isPlainDate(bounds.to)) {
    toMs = startOfDayInZone(...dateTuple(bounds.to), tz) + DAY_MS - 1;
  } else if (bounds.to) {
    toMs = Date.parse(bounds.to);
  } else {
    toMs = now.getTime();
  }

  if (bounds.from && isPlainDate(bounds.from)) {
    fromMs = startOfDayInZone(...dateTuple(bounds.from), tz);
  } else if (bounds.from) {
    fromMs = Date.parse(bounds.from);
  } else {
    fromMs = toMs - DEFAULT_PERIOD_DAYS * DAY_MS;
  }

  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

/** Empty/default filter set matching parseAdminFilters' defaults. */
export function defaultFilters(): AdminFilters {
  return { page: 1, pageSize: DEFAULT_PAGE_SIZE, granularity: DEFAULT_GRANULARITY };
}
