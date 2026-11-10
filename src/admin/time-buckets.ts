import type { Granularity } from "../shared/admin/types.js";
import { startOfDayInZone, zonedParts } from "../shared/admin/filters.js";

export interface Bucket {
  /** ISO UTC instant of the bucket start (inclusive). */
  bucketStart: string;
  /** ISO UTC instant of the last millisecond of the bucket (inclusive). */
  bucketEnd: string;
}

interface Day {
  year: number;
  month: number;
  day: number;
}

function addDays(d: Day, n: number): Day {
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function compareDays(a: Day, b: Day): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

/** Monday-based start of the ISO week. */
function startOfWeek(d: Day): Day {
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const weekday = date.getUTCDay(); // 0 = Sunday
  // Return a copy: mutating the caller's object would corrupt the first bucket.
  return weekday === 1 ? { ...d } : addDays(d, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * Bucket boundaries for the timeseries, computed on wall-clock calendars of
 * `tz` (day/week/month/year: weeks start Monday). Empty buckets are filled with
 * zero by the caller; at most `MAX_BUCKETS` (400) buckets are returned — the
 * oldest are dropped when the period is wider than that.
 */
export function buildBuckets(
  from: Date,
  to: Date,
  granularity: Granularity,
  tz: string,
  maxBuckets = 400,
): Bucket[] {
  const fromMs = from.getTime();
  const toMs = Math.max(from.getTime(), to.getTime());
  const firstDay = zonedParts(from, tz);
  const lastDay = zonedParts(new Date(toMs), tz);

  const starts: Day[] = [];
  if (granularity === "day") {
    const totalDays = Math.round(compareDays(lastDay, firstDay) / 86_400_000) + 1;
    const skip = Math.max(0, totalDays - maxBuckets);
    for (let d = addDays(firstDay, skip), i = 0; compareDays(d, lastDay) <= 0 && i < maxBuckets; i++) {
      starts.push(d);
      d = addDays(d, 1);
    }
  } else if (granularity === "week") {
    let d = startOfWeek(firstDay);
    while (compareDays(d, lastDay) <= 0) {
      starts.push(d);
      d = addDays(d, 7);
    }
  } else if (granularity === "month") {
    let d: Day = { year: firstDay.year, month: firstDay.month, day: 1 };
    while (compareDays(d, lastDay) <= 0) {
      starts.push(d);
      d = d.month === 12 ? { year: d.year + 1, month: 1, day: 1 } : { ...d, month: d.month + 1 };
    }
  } else {
    for (let y = firstDay.year; y <= lastDay.year; y++) starts.push({ year: y, month: 1, day: 1 });
  }

  const kept = starts.length > maxBuckets ? starts.slice(starts.length - maxBuckets) : starts;
  return kept.map((d, i) => {
    const nextStart = i + 1 < kept.length
      ? startOfDayInZone(kept[i + 1]!.year, kept[i + 1]!.month, kept[i + 1]!.day, tz)
      : startOfDayInZone(d.year, d.month, d.day, tz) + 24 * 60 * 60 * 1000;
    const startMs = startOfDayInZone(d.year, d.month, d.day, tz);
    const clampedStart = i === 0 ? Math.max(startMs, fromMs) : startMs;
    return {
      bucketStart: new Date(clampedStart).toISOString(),
      bucketEnd: new Date(nextStart - 1).toISOString(),
    };
  });
}
