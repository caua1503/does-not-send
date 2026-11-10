import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, sum } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import * as schema from "../db/schema.js";
import { events, sessions, transfers } from "../db/schema.js";
import type {
  AdminFilters,
  Category,
  CloseReason,
  TransferStatus,
} from "../shared/admin/types.js";
import { toIsoString } from "../shared/admin/format.js";

type ReaderDb = BunSQLDatabase<typeof schema>;

export const MAX_RELATED_SESSIONS = 20;
const TOP_RANKING = 10;
const MAX_TIMELINE_ITEMS = 500;
const STATUS_ORDER: readonly TransferStatus[] = ["completed", "failed", "receiving"];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a database)
// ---------------------------------------------------------------------------

/**
 * Escapes LIKE metacharacters (backslash first) so user input matches
 * literally. Pair with `ESCAPE '\'` — without it, `%`/`_` in the search box
 * would act as wildcards.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function likePattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

export type SortKey =
  | "startedAt"
  | "finishedAt"
  | "name"
  | "size"
  | "status"
  | "category"
  | "createdAt"
  | "pairedAt"
  | "closedAt"
  | "fileCount"
  | "totalBytes";

export const TRANSFER_SORTS: readonly SortKey[] = [
  "startedAt",
  "finishedAt",
  "name",
  "size",
  "status",
  "category",
];
export const SESSION_SORTS: readonly SortKey[] = [
  "createdAt",
  "pairedAt",
  "closedAt",
  "fileCount",
  "totalBytes",
];

/** Shared with the admin frontend so its table headers match the whitelist. */
export const SORT_KEYS = { transfers: TRANSFER_SORTS, sessions: SESSION_SORTS } as const;

/** Only whitelisted keys ever reach an ORDER BY; anything else uses the default. */
export function parseSort<T extends SortKey>(
  raw: unknown,
  allowed: readonly SortKey[],
  fallback: T,
): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

export function parseDirection(raw: unknown, fallback: "asc" | "desc"): "asc" | "desc" {
  return raw === "asc" || raw === "desc" ? raw : fallback;
}

/** Fill empty buckets with zero so charts keep a continuous axis. */
export function fillBuckets(
  buckets: Array<{ bucketStart: string; bucketEnd: string }>,
  rows: Array<{ bucket: string; volumeBytes: number; transfers: number }>,
): Array<{ bucketStart: string; bucketEnd: string; volumeBytes: number; transfers: number }> {
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  return buckets.map((b) => {
    const row = byBucket.get(b.bucketStart);
    return {
      bucketStart: b.bucketStart,
      bucketEnd: b.bucketEnd,
      volumeBytes: row?.volumeBytes ?? 0,
      transfers: row?.transfers ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface TransferRowDto {
  id: string;
  sessionId: string;
  sessionVisualId: string;
  name: string;
  extension: string;
  category: Category;
  size: number;
  status: TransferStatus;
  startedAt: string;
  finishedAt: string | null;
}

export interface SessionRowDto {
  id: string;
  visualId: string;
  computerIp: string | null;
  phoneIp: string | null;
  createdAt: string;
  pairedAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason | null;
  isActive: boolean;
  fileCount: number;
  totalBytes: number;
}

interface TransferSourceRow {
  id: string;
  sessionId: string;
  sessionVisualId: string;
  name: string;
  extension: string;
  category: Category;
  size: number | string | bigint;
  status: TransferStatus;
  startedAt: string | Date;
  finishedAt: string | Date | null;
}

interface SessionSourceRow {
  id: string;
  visualId: string;
  computerIp: string | null;
  phoneIp: string | null;
  createdAt: string | Date;
  pairedAt: string | Date | null;
  closedAt: string | Date | null;
  closeReason: CloseReason | null;
  fileCount: number | string | bigint | null;
  totalBytes: number | string | bigint | null;
}

function mapTransfer(row: TransferSourceRow): TransferRowDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionVisualId: row.sessionVisualId,
    name: row.name,
    extension: row.extension,
    category: row.category,
    size: Number(row.size),
    status: row.status,
    startedAt: toIsoString(row.startedAt) ?? "",
    finishedAt: toIsoString(row.finishedAt),
  };
}

function mapSession(row: SessionSourceRow): SessionRowDto {
  return {
    id: row.id,
    visualId: row.visualId,
    computerIp: row.computerIp,
    phoneIp: row.phoneIp,
    createdAt: toIsoString(row.createdAt) ?? "",
    pairedAt: toIsoString(row.pairedAt),
    closedAt: toIsoString(row.closedAt),
    closeReason: row.closeReason,
    isActive: row.closedAt === null,
    fileCount: Number(row.fileCount ?? 0),
    totalBytes: Number(row.totalBytes ?? 0),
  };
}

/** asc()/desc() accept both columns and aliased aggregates (e.g. SUM/COUNT). */
function orderDir(dir: "asc" | "desc", column: AnyColumn | SQL.Aliased): SQL {
  if (dir === "asc") return asc(column);
  return desc(column);
}

function paginate<T>(
  items: T[],
  total: number,
  filters: AdminFilters,
): { items: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  return {
    items,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / filters.pageSize),
  };
}

const transferColumns = {
  id: transfers.id,
  sessionId: transfers.sessionId,
  sessionVisualId: sessions.visualId,
  name: transfers.name,
  extension: transfers.extension,
  category: transfers.category,
  size: transfers.size,
  status: transfers.status,
  startedAt: transfers.startedAt,
  finishedAt: transfers.finishedAt,
};

export interface SummaryDto {
  totals: {
    files: number;
    volumeBytes: number;
    sessions: number;
    transfers: number;
    avgSize: number;
    largestSize: number;
  };
  byStatus: Array<{ status: TransferStatus; count: number }>;
  byCategory: Array<{ category: Category; count: number; volumeBytes: number }>;
  topExtensions: Array<{ extension: string; count: number; volumeBytes: number }>;
  topPhoneIps: Array<{ ip: string; count: number }>;
  refusedPairings: number;
}

export interface TimelineQueryRow {
  at: string;
  kind: "transfer_started" | "transfer_finished";
  transferId: string;
  status: TransferStatus;
  size: number;
}

export interface SessionDetailRows {
  session: SessionRowDto;
  transfers: TransferRowDto[];
  relatedSessions: SessionRowDto[];
  timelineRows: TimelineQueryRow[];
}

// ---------------------------------------------------------------------------
// Queries (read-only, always through the reader pool)
// ---------------------------------------------------------------------------

export function createAdminQueries(db: ReaderDb) {
  /** Completed-only per-session totals via SUM/COUNT over transfers. */
  function sessionTotals() {
    return db
      .select({
        sessionId: transfers.sessionId,
        fileCount: count(transfers.id).as("file_count"),
        totalBytes: sum(transfers.size).as("total_bytes"),
      })
      .from(transfers)
      .where(eq(transfers.status, "completed"))
      .groupBy(transfers.sessionId)
      .as("totals");
  }

  const sessionColumns = {
    id: sessions.id,
    visualId: sessions.visualId,
    computerIp: sessions.computerIp,
    phoneIp: sessions.phoneIp,
    createdAt: sessions.createdAt,
    pairedAt: sessions.pairedAt,
    closedAt: sessions.closedAt,
    closeReason: sessions.closeReason,
  };

  // Bounds are ISO instants (Period); a bare date reaches the driver as
  // `date <= timestamptz`, which Postgres evaluates like `date < timestamptz`,
  // so it must never be passed through as-is.
  function within(column: AnyColumn, from: string, to: string): SQL {
    return and(gte(column, from), lte(column, to))!;
  }

  function transferWhere(filters: AdminFilters): SQL | undefined {
    const conditions: Array<SQL | undefined> = [];
    if (filters.from && filters.to) {
      conditions.push(within(transfers.startedAt, filters.from, filters.to));
    }
    if (filters.category) conditions.push(eq(transfers.category, filters.category));
    if (filters.status) conditions.push(eq(transfers.status, filters.status));
    if (filters.minSize !== undefined) conditions.push(gte(transfers.size, filters.minSize));
    if (filters.maxSize !== undefined) conditions.push(lte(transfers.size, filters.maxSize));
    // ilike() would forget the ESCAPE clause, leaving `\` escaping partially on.
    if (filters.q) {
      conditions.push(sql`${transfers.name} ILIKE ${likePattern(filters.q)} ESCAPE '\\'`);
    }
    if (filters.session) {
      conditions.push(
        or(
          eq(transfers.sessionId, filters.session),
          inArray(
            transfers.sessionId,
            db.select({ id: sessions.id }).from(sessions).where(eq(sessions.visualId, filters.session)),
          ),
        ),
      );
    }
    if (filters.ip) {
      conditions.push(
        inArray(
          transfers.sessionId,
          db
            .select({ id: sessions.id })
            .from(sessions)
            .where(or(eq(sessions.computerIp, filters.ip), eq(sessions.phoneIp, filters.ip))),
        ),
      );
    }
    const defined = conditions.filter((c): c is SQL => c !== undefined);
    return defined.length > 0 ? and(...defined) : undefined;
  }

  function sessionWhere(filters: AdminFilters): SQL | undefined {
    const conditions: Array<SQL | undefined> = [];
    if (filters.from && filters.to) {
      conditions.push(within(sessions.createdAt, filters.from, filters.to));
    }
    if (filters.ip) {
      conditions.push(or(eq(sessions.computerIp, filters.ip), eq(sessions.phoneIp, filters.ip)));
    }
    if (filters.session) {
      conditions.push(or(eq(sessions.id, filters.session), eq(sessions.visualId, filters.session)));
    }
    const defined = conditions.filter((c): c is SQL => c !== undefined);
    return defined.length > 0 ? and(...defined) : undefined;
  }

  function pairingRefusedWhere(filters: AdminFilters): SQL {
    const conditions: SQL[] = [eq(events.type, "pairing_refused"), sql`${events.ip} <> ''`];
    if (filters.from && filters.to) {
      conditions.push(within(events.at, filters.from, filters.to));
    }
    if (filters.ip) conditions.push(eq(events.ip, filters.ip));
    if (filters.session) {
      conditions.push(
        inArray(
          events.sessionId,
          db
            .select({ id: sessions.id })
            .from(sessions)
            .where(or(eq(sessions.id, filters.session), eq(sessions.visualId, filters.session))),
        ),
      );
    }
    return and(...conditions) as SQL;
  }

  async function listTransfers(
    filters: AdminFilters,
    sort: SortKey,
    dir: "asc" | "desc",
  ) {
    const where = transferWhere(filters);
    const totalRows = await db.select({ total: count() }).from(transfers).where(where);
    const orderColumns: Record<string, AnyColumn | SQL.Aliased> = {
      startedAt: transfers.startedAt,
      finishedAt: transfers.finishedAt,
      name: transfers.name,
      size: transfers.size,
      status: transfers.status,
      category: transfers.category,
    };
    const column = orderColumns[sort] ?? transfers.startedAt;
    const rows = await db
      .select(transferColumns)
      .from(transfers)
      .innerJoin(sessions, eq(transfers.sessionId, sessions.id))
      .where(where)
      .orderBy(orderDir(dir, column), desc(transfers.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
    return paginate(rows.map(mapTransfer), Number(totalRows[0]?.total ?? 0), filters);
  }

  async function listSessions(
    filters: AdminFilters,
    sort: SortKey,
    dir: "asc" | "desc",
  ) {
    const where = sessionWhere(filters);
    const totals = sessionTotals();
    const totalRows = await db.select({ total: count() }).from(sessions).where(where);
    const orderColumns: Record<string, AnyColumn | SQL.Aliased> = {
      createdAt: sessions.createdAt,
      pairedAt: sessions.pairedAt,
      closedAt: sessions.closedAt,
      fileCount: totals.fileCount,
      totalBytes: totals.totalBytes,
    };
    const column = orderColumns[sort] ?? sessions.createdAt;
    const rows = await db
      .select({ ...sessionColumns, fileCount: totals.fileCount, totalBytes: totals.totalBytes })
      .from(sessions)
      .leftJoin(totals, eq(totals.sessionId, sessions.id))
      .where(where)
      .orderBy(orderDir(dir, column), desc(sessions.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
    return paginate(rows.map(mapSession), Number(totalRows[0]?.total ?? 0), filters);
  }

  async function summary(filters: AdminFilters): Promise<SummaryDto> {
    const base = transferWhere(filters);
    const completed = and(eq(transfers.status, "completed"), base);

    const [completedRows, scopeRows, statusRows, categoryRows, extensionRows, phoneIpRows, refusedRows] =
      await Promise.all([
        db
          .select({
            files: count(transfers.id),
            volume: sum(transfers.size),
            avg: sql<number>`coalesce(avg(${transfers.size}), 0)::float8`,
            largest: sql<number>`coalesce(max(${transfers.size}), 0)::bigint`,
          })
          .from(transfers)
          .where(completed),
        db
          .select({
            transfers: count(transfers.id),
            sessions: sql<number>`count(distinct ${transfers.sessionId})::int`,
          })
          .from(transfers)
          .where(base),
        db
          .select({ status: transfers.status, n: count() })
          .from(transfers)
          .where(base)
          .groupBy(transfers.status),
        db
          .select({ category: transfers.category, n: count(transfers.id), volume: sum(transfers.size) })
          .from(transfers)
          .where(completed)
          .groupBy(transfers.category)
          .orderBy(desc(count(transfers.id)), desc(sum(transfers.size))),
        db
          .select({ extension: transfers.extension, n: count(transfers.id), volume: sum(transfers.size) })
          .from(transfers)
          .where(completed)
          .groupBy(transfers.extension)
          .orderBy(desc(count(transfers.id)), desc(sum(transfers.size)))
          .limit(TOP_RANKING),
        // IPs are canonical session data: they only follow the period/IP/session
        // scope (no pair = no phone), not the transfer facets.
        db
          .select({ ip: sessions.phoneIp, n: count(sessions.id).as("n") })
          .from(sessions)
          .where(and(sql`coalesce(${sessions.phoneIp}, '') <> ''`, sessionWhere(filters)))
          .groupBy(sessions.phoneIp)
          .orderBy(desc(count(sessions.id)))
          .limit(TOP_RANKING),
        db.select({ n: count() }).from(events).where(pairingRefusedWhere(filters)),
      ]);

    const completedRow = completedRows[0];
    const files = Number(completedRow?.files ?? 0);
    const statusCounts = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
    return {
      totals: {
        files,
        volumeBytes: Number(completedRow?.volume ?? 0),
        sessions: Number(scopeRows[0]?.sessions ?? 0),
        transfers: Number(scopeRows[0]?.transfers ?? 0),
        avgSize: files > 0 ? Math.round(Number(completedRow?.avg ?? 0)) : 0,
        largestSize: Number(completedRow?.largest ?? 0),
      },
      byStatus: STATUS_ORDER.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
      byCategory: categoryRows.map((r) => ({
        category: r.category,
        count: Number(r.n),
        volumeBytes: Number(r.volume ?? 0),
      })),
      topExtensions: extensionRows.map((r) => ({
        extension: r.extension,
        count: Number(r.n),
        volumeBytes: Number(r.volume ?? 0),
      })),
      topPhoneIps: phoneIpRows
        .filter((r): r is { ip: string; n: number } => r.ip !== null)
        .map((r) => ({ ip: r.ip, count: Number(r.n) })),
      refusedPairings: Number(refusedRows[0]?.n ?? 0),
    };
  }

  async function timeseries(
    filters: AdminFilters,
    buckets: Array<{ bucketStart: string; bucketEnd: string }>,
  ): Promise<Array<{ bucket: string; volumeBytes: number; transfers: number }>> {
    if (buckets.length === 0) return [];
    const bounds = sql.join(
      buckets.map((b) => sql`(${b.bucketStart}::timestamptz, ${b.bucketEnd}::timestamptz)`),
      sql`, `,
    );
    const rows = await db
      .select({
        // Boundaries are echoed back verbatim; the server (not SQL) assigns each
        // row to its bucket, so tz/DST rounding can never split or shift buckets.
        bucketStart: sql<string>`to_char(b.bucket_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
          "bucket_start",
        ),
        startedAt: sql<string>`to_char(${transfers.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
          "started_at",
        ),
        size: transfers.size,
        status: transfers.status,
      })
      .from(transfers)
      .innerJoin(
        sql`(VALUES ${bounds}) AS b(bucket_start, bucket_end)`,
        sql`${transfers.startedAt} >= b.bucket_start AND ${transfers.startedAt} <= b.bucket_end`,
      )
      .where(transferWhere(filters));

    const index = new Map(buckets.map((b, i) => [b.bucketStart, i]));
    const points = buckets.map((b) => ({ bucket: b.bucketStart, volumeBytes: 0, transfers: 0 }));
    for (const row of rows) {
      const i = index.get(row.bucketStart);
      const point = i === undefined ? undefined : points[i];
      if (!point) continue;
      void row.startedAt;
      point.transfers += 1;
      if (row.status === "completed") point.volumeBytes += Number(row.size);
    }
    return points;
  }

  async function getSessionRow(id: string): Promise<SessionRowDto | null> {
    const totals = sessionTotals();
    const rows = await db
      .select({ ...sessionColumns, fileCount: totals.fileCount, totalBytes: totals.totalBytes })
      .from(sessions)
      .leftJoin(totals, eq(totals.sessionId, sessions.id))
      .where(eq(sessions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? mapSession(row) : null;
  }

  async function getTransfer(id: string): Promise<{ transfer: TransferRowDto; session: SessionRowDto } | null> {
    const rows = await db
      .select(transferColumns)
      .from(transfers)
      .innerJoin(sessions, eq(transfers.sessionId, sessions.id))
      .where(eq(transfers.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const session = await getSessionRow(row.sessionId);
    return session ? { transfer: mapTransfer(row), session } : null;
  }

  async function getSessionDetail(id: string): Promise<SessionDetailRows | null> {
    const session = await getSessionRow(id);
    if (!session) return null;

    const ips = [session.computerIp, session.phoneIp].filter((ip): ip is string => Boolean(ip));
    const totals = sessionTotals();
    const [transferRows, relatedRows] = await Promise.all([
      db
        .select(transferColumns)
        .from(transfers)
        .innerJoin(sessions, eq(transfers.sessionId, sessions.id))
        .where(eq(transfers.sessionId, id))
        .orderBy(desc(transfers.startedAt))
        .limit(MAX_TIMELINE_ITEMS),
      ips.length === 0
        ? Promise.resolve([] as SessionSourceRow[])
        : db
            .select({ ...sessionColumns, fileCount: totals.fileCount, totalBytes: totals.totalBytes })
            .from(sessions)
            .leftJoin(totals, eq(totals.sessionId, sessions.id))
            .where(
              and(
                sql`${sessions.id} <> ${id}`,
                or(inArray(sessions.computerIp, ips), inArray(sessions.phoneIp, ips)),
              ),
            )
            .orderBy(desc(sessions.createdAt))
            .limit(MAX_RELATED_SESSIONS),
    ]);

    const timelineRows: TimelineQueryRow[] = [];
    for (const t of transferRows) {
      timelineRows.push({
        at: toIsoString(t.startedAt) ?? "",
        kind: "transfer_started",
        transferId: t.id,
        status: t.status,
        size: Number(t.size),
      });
      const finishedAt = toIsoString(t.finishedAt);
      if (finishedAt) {
        timelineRows.push({
          at: finishedAt,
          kind: "transfer_finished",
          transferId: t.id,
          status: t.status,
          size: Number(t.size),
        });
      }
    }

    return {
      session,
      transfers: transferRows.map(mapTransfer),
      relatedSessions: relatedRows.map(mapSession),
      timelineRows,
    };
  }

  return { listTransfers, listSessions, summary, timeseries, getTransfer, getSessionDetail };
}

