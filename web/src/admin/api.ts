import { AdminClient } from "../../../src/shared/admin/client.ts";
import { writeFilterParams } from "./filter-url.ts";
import type { AdminFilters } from "../../../src/shared/admin/types.ts";
import type {
  AdminSummary,
  Paginated,
  SessionDetail,
  SessionRow,
  TimeseriesResponse,
  TransferDetail,
  TransferRow,
} from "../../../src/shared/admin/types.ts";

export type SortDirection = "asc" | "desc";

export interface ListQuery {
  filters: AdminFilters;
  /** Whitelisted by the server (SORT_KEYS); anything else falls back to default. */
  sort: string;
  dir: SortDirection;
}

export interface AdminApi {
  me(): Promise<{ authenticated: boolean }>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  summary(filters: AdminFilters, signal: AbortSignal): Promise<AdminSummary>;
  timeseries(filters: AdminFilters, signal: AbortSignal): Promise<TimeseriesResponse>;
  transfers(query: ListQuery, signal: AbortSignal): Promise<Paginated<TransferRow>>;
  sessions(query: ListQuery, signal: AbortSignal): Promise<Paginated<SessionRow>>;
  sessionDetail(id: string, signal: AbortSignal): Promise<SessionDetail>;
  transferDetail(id: string, signal: AbortSignal): Promise<TransferDetail>;
}

function listParams({ filters, sort, dir }: ListQuery): URLSearchParams {
  const params = writeFilterParams(new URLSearchParams(), filters);
  params.set("sort", sort);
  params.set("dir", dir);
  return params;
}

export function createAdminApi(onUnauthorized: () => void): AdminApi {
  const client = new AdminClient({ onUnauthorized });
  const list = <T>(path: string, query: ListQuery, signal: AbortSignal): Promise<T> =>
    client.request<T>(`${path}?${listParams(query).toString()}`, signal);
  return {
    me: () => client.me(),
    login: (username, password) => client.login(username, password),
    logout: () => client.logout(),
    summary: (filters, signal) => client.summary(filters, signal),
    timeseries: (filters, signal) => client.timeseries(filters, signal),
    transfers: (query, signal) => list("/admin/api/transfers", query, signal),
    sessions: (query, signal) => list("/admin/api/sessions", query, signal),
    sessionDetail: (id, signal) => client.sessionDetail(id, signal),
    transferDetail: (id, signal) => client.transferDetail(id, signal),
  };
}
