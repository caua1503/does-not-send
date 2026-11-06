import type {
  AdminSummary,
  MeResponse,
  Paginated,
  SessionDetail,
  SessionRow,
  TimeseriesResponse,
  TransferDetail,
  TransferRow,
} from "./types.js";
import { serializeAdminFilters } from "./filters.js";
import type { AdminFilters } from "./types.js";

export interface ApiErrorInfo {
  status: number;
  code: string;
  message: string;
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(info: ApiErrorInfo) {
    super(info.message || info.code || `HTTP ${info.status}`);
    this.name = "AdminApiError";
    this.status = info.status;
    this.code = info.code;
  }
}

export interface AdminClientOptions {
  /** Base URL for the admin API. Default: same origin. */
  baseUrl?: string;
  /** Injectable fetch (tests). Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Invoked once whenever the API answers 401 (session expired). */
  onUnauthorized?: () => void;
}

function parseErrorBody(raw: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    return {
      code: typeof parsed.error?.code === "string" ? parsed.error.code : "unknown",
      message: typeof parsed.error?.message === "string" ? parsed.error.message : "",
    };
  } catch {
    return { code: "unknown", message: raw.slice(0, 200) };
  }
}

export class AdminClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly onUnauthorized?: () => void;

  constructor(options: AdminClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
    if (options.onUnauthorized) this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        credentials: "same-origin",
        ...init,
        headers: { accept: "application/json", ...(init?.headers ?? {}) },
      }) as Response;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new AdminApiError({ status: 0, code: "network_error", message: "Falha de rede" });
    }

    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new AdminApiError({ status: 401, code: "unauthorized", message: "Sessão expirada" });
    }

    const raw = await response.text();
    if (!response.ok) {
      const body = parseErrorBody(raw);
      throw new AdminApiError({
        status: response.status,
        code: body.code,
        message: body.message,
      });
    }
    if (raw === "") return undefined as T;
    return JSON.parse(raw) as T;
  }

  async login(username: string, password: string): Promise<void> {
    await this.request(
      "/admin/api/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
    );
  }

  async logout(): Promise<void> {
    await this.request("/admin/api/logout", { method: "POST" });
  }

  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("/admin/api/me");
  }

  filtersQuery(filters: Partial<AdminFilters>): string {
    return serializeAdminFilters({ ...mergedDefaults(), ...filters });
  }

  async summary(filters: Partial<AdminFilters>, signal?: AbortSignal): Promise<AdminSummary> {
    const q = this.filtersQuery(filters);
    return this.request<AdminSummary>(`/admin/api/summary?${q}`, { signal: signal ?? null });
  }

  async timeseries(filters: Partial<AdminFilters>, signal?: AbortSignal): Promise<TimeseriesResponse> {
    const q = this.filtersQuery(filters);
    return this.request<TimeseriesResponse>(`/admin/api/timeseries?${q}`, { signal: signal ?? null });
  }

  async transfers(
    filters: Partial<AdminFilters>,
    signal?: AbortSignal,
  ): Promise<Paginated<TransferRow>> {
    const q = this.filtersQuery(filters);
    return this.request<Paginated<TransferRow>>(`/admin/api/transfers?${q}`, {
      signal: signal ?? null,
    });
  }

  async sessions(
    filters: Partial<AdminFilters>,
    signal?: AbortSignal,
  ): Promise<Paginated<SessionRow>> {
    const q = this.filtersQuery(filters);
    return this.request<Paginated<SessionRow>>(`/admin/api/sessions?${q}`, {
      signal: signal ?? null,
    });
  }

  async sessionDetail(id: string, signal?: AbortSignal): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/admin/api/sessions/${encodeURIComponent(id)}`, {
      signal: signal ?? null,
    });
  }

  async transferDetail(id: string, signal?: AbortSignal): Promise<TransferDetail> {
    return this.request<TransferDetail>(`/admin/api/transfers/${encodeURIComponent(id)}`, {
      signal: signal ?? null,
    });
  }
}

function mergedDefaults(): AdminFilters {
  return { page: 1, pageSize: 25, granularity: "day" };
}
