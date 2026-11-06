/**
 * Formatting helpers shared by the admin backend and frontend.
 * Uses Intl (pt-BR) with an explicit IANA timezone (default: ADMIN_TZ default
 * America/Sao_Paulo); dates travel as ISO UTC strings and bytes as plain
 * numbers (never BigInt). Datetime output is composed manually from formatToParts
 * so punctuation stays stable across ICU versions.
 */

export const DEFAULT_TZ = "America/Sao_Paulo";
export const LOCALE = "pt-BR";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

const ONE_DECIMAL = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const INTEGER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Human-readable size, base 1024, one decimal ("1.024 B", "1,0 KB", "1,0 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `0 ${UNITS[0]}`;
  if (bytes < 1024) return `${bytes} ${UNITS[0]}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${ONE_DECIMAL.format(value)} ${UNITS[unit]}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return INTEGER.format(value);
}

function parseIso(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

type PartMap = Map<string, string>;

function dateTimeParts(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  tz: string,
): PartMap {
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour12: false, ...options })
    .formatToParts(date);
  const map = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== "literal") map.set(part.type, part.value);
  }
  return map;
}

function joinDay(map: PartMap): string {
  return `${map.get("day")}/${map.get("month")}/${map.get("year")}`;
}

/** Calendar date in the given timezone: "dd/mm/aaaa". */
export function formatDate(iso: string, tz: string = DEFAULT_TZ): string {
  const date = parseIso(iso);
  if (!date) return "—";
  return joinDay(
    dateTimeParts(date, { day: "2-digit", month: "2-digit", year: "numeric" }, tz),
  );
}

/** Date + time in the given timezone: "dd/mm/aaaa HH:mm". */
export function formatDateTime(iso: string, tz: string = DEFAULT_TZ): string {
  const date = parseIso(iso);
  if (!date) return "—";
  const map = dateTimeParts(
    date,
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    tz,
  );
  return `${joinDay(map)} ${map.get("hour")}:${map.get("minute")}`;
}

/** Time only in the given timezone: "HH:mm:ss". */
export function formatTime(iso: string, tz: string = DEFAULT_TZ): string {
  const date = parseIso(iso);
  if (!date) return "—";
  const map = dateTimeParts(
    date,
    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
    tz,
  );
  return `${map.get("hour")}:${map.get("minute")}:${map.get("second")}`;
}

/** pt-BR short months come as "nov." — keep them without the trailing period. */
function shortMonth(date: Date, tz: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, month: "short" })
    .format(date)
    .replace(/\.$/, "");
}

/**
 * Compact bucket label for chart axes. Day: "05 nov"; week/month: "mar 26";
 * year: "26".
 */
export function formatBucketLabel(
  bucketStart: string,
  granularity: "day" | "week" | "month" | "year",
  tz: string = DEFAULT_TZ,
): string {
  const date = parseIso(bucketStart);
  if (!date) return "—";
  const map = dateTimeParts(date, { day: "2-digit", month: "2-digit", year: "2-digit" }, tz);
  const month = shortMonth(date, tz);
  if (granularity === "year") return map.get("year") ?? "—";
  if (granularity === "week" || granularity === "month") {
    return `${month} ${map.get("year")}`;
  }
  return `${map.get("day")} ${month}`;
}
