/** Columns the admin lists may sort by. Only these ever reach an ORDER BY. */
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
