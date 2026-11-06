/**
 * Shared contract for the /admin dashboard.
 * This module must never import server-only (Bun, Fastify, Drizzle) or
 * DOM-specific code: it is consumed by both the Fastify server and the
 * bundled admin frontend.
 */

export type TransferStatus = "receiving" | "completed" | "failed";

export type Category =
  | "images"
  | "videos"
  | "audios"
  | "pdfs"
  | "documents"
  | "archives"
  | "other";

export const CATEGORIES: readonly Category[] = [
  "images",
  "videos",
  "audios",
  "pdfs",
  "documents",
  "archives",
  "other",
];

export type CloseReason =
  | "idle_timeout"
  | "computer_lost"
  | "phone_lost"
  | "user_closed"
  | "closed"
  | "server_restart";

export type EventType = "pairing_refused" | "qr_reused";

export type Granularity = "day" | "week" | "month" | "year";

export const GRANULARITIES: readonly Granularity[] = ["day", "week", "month", "year"];

/** Hard cap on buckets per timeseries query (matches backend limit). */
export const MAX_BUCKETS = 400;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface AdminFilters {
  /** ISO UTC date or datetime (inclusive). */
  from?: string;
  /** ISO UTC date or datetime (inclusive). */
  to?: string;
  /** Matches session.computer_ip OR session.phone_ip. */
  ip?: string;
  /** Session id or visual id. */
  session?: string;
  category?: Category;
  status?: TransferStatus;
  /** Bytes. */
  minSize?: number;
  /** Bytes. */
  maxSize?: number;
  /** Free text (matches transfer file name). */
  q?: string;
  page: number;
  pageSize: number;
  granularity: Granularity;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface SessionRef {
  id: string;
  visualId: string;
}

export interface TransferRow {
  id: string;
  sessionId: string;
  sessionVisualId: string;
  /** File name (admin UI only; never written to logs). */
  name: string;
  extension: string;
  category: Category;
  size: number;
  status: TransferStatus;
  /** ISO UTC. */
  startedAt: string;
  /** ISO UTC or null while receiving. */
  finishedAt: string | null;
}

export interface SessionRow {
  id: string;
  visualId: string;
  /** Correlation data only, never a device identity. */
  computerIp: string | null;
  phoneIp: string | null;
  /** ISO UTC. */
  createdAt: string;
  /** ISO UTC or null when never paired. */
  pairedAt: string | null;
  /** ISO UTC or null while active. */
  closedAt: string | null;
  closeReason: CloseReason | null;
  /** true when closedAt is null. */
  isActive: boolean;
  /** Completed files and bytes counted from transfers (never a session column). */
  fileCount: number;
  totalBytes: number;
}

export interface TimeseriesPoint {
  /** ISO UTC instant for the start of the bucket. */
  bucketStart: string;
  /** ISO UTC instant for the end of the bucket. */
  bucketEnd: string;
  volumeBytes: number;
  transfers: number;
}

export interface TimeseriesResponse {
  granularity: Granularity;
  points: TimeseriesPoint[];
}

export interface AdminSummary {
  period: { from: string; to: string };
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

export interface SessionTimelineItemBase {
  /** ISO UTC. */
  at: string;
}

export type SessionTimelineItem =
  | (SessionTimelineItemBase & { kind: "created" })
  | (SessionTimelineItemBase & { kind: "paired" })
  | (SessionTimelineItemBase & { kind: "transfer_started"; transferId: string })
  | (SessionTimelineItemBase & {
      kind: "transfer_finished";
      transferId: string;
      status: TransferStatus;
      size: number;
    })
  | (SessionTimelineItemBase & { kind: "closed"; reason: CloseReason });

export interface SessionDetail {
  session: SessionRow;
  transfers: TransferRow[];
  timeline: SessionTimelineItem[];
  /** Other sessions sharing the same IP (correlation, max 20). */
  relatedSessions: SessionRow[];
}

export interface TransferDetail {
  transfer: TransferRow;
  session: SessionRow;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface MeResponse {
  authenticated: boolean;
  /** ISO UTC, only present while authenticated. */
  expiresAt?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
