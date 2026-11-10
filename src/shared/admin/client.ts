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

const REQUEST_TIMEOUT_MS = 15_000;

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

  /** Raw GET with the admin credentials; callers own path validation. */
  async request<T>(path: string, signal?: AbortSignal | null): Promise<T> {
    return this.send<T>(path, { signal: signal ?? null });
  }

  private async send<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    // The admin API answers quickly (5s statement timeout); never leave the UI hanging.
    const callerSignal = init?.signal ?? null;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        credentials: "same-origin",
        ...init,
        signal,
        headers: { accept: "application/json", ...(init?.headers ?? {}) },
      }) as Response;
    } catch (err) {
      // A caller-initiated abort is control flow (navigation/refresh), not an error to show.
      if (callerSignal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        throw err instanceof DOMException ? err : new DOMException("Aborted", "AbortError");
      }
      if (timeout.aborted || (err instanceof DOMException && err.name === "TimeoutError")) {
        throw new AdminApiError({ status: 0, code: "timeout", message: "Tempo esgotado" });
      }
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
    await this.send(
      "/admin/api/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
    );
  }

  async logout(): Promise<void> {
    await this.send("/admin/api/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch((err: unknown) => {
      // An expired session already logged the user out; clearing the cookie is enough.
      if (err instanceof AdminApiError && err.status === 401) return;
      throw err;
    });
  }

  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("/admin/api/me");
  }

  filtersQuery(filters: Partial<AdminFilters>): string {
    return serializeAdminFilters({ ...mergedDefaults(), ...filters });
  }

  private path(path: string, filters: Partial<AdminFilters>): string {
    return `${path}?${this.filtersQuery(filters)}`;
  }

  async summary(filters: Partial<AdminFilters>, signal?: AbortSignal): Promise<AdminSummary> {
    return this.request<AdminSummary>(this.path("/admin/api/summary", filters), signal);
  }

  async timeseries(filters: Partial<AdminFilters>, signal?: AbortSignal): Promise<TimeseriesResponse> {
    return this.request<TimeseriesResponse>(this.path("/admin/api/timeseries", filters), signal);
  }

  async transfers(
    filters: Partial<AdminFilters>,
    signal?: AbortSignal,
  ): Promise<Paginated<TransferRow>> {
    return this.request<Paginated<TransferRow>>(this.path("/admin/api/transfers", filters), signal);
  }

  async sessions(
    filters: Partial<AdminFilters>,
    signal?: AbortSignal,
  ): Promise<Paginated<SessionRow>> {
    return this.request<Paginated<SessionRow>>(this.path("/admin/api/sessions", filters), signal);
  }

  async sessionDetail(id: string, signal?: AbortSignal): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/admin/api/sessions/${encodeURIComponent(id)}`, signal);
  }

  async transferDetail(id: string, signal?: AbortSignal): Promise<TransferDetail> {
    return this.request<TransferDetail>(`/admin/api/transfers/${encodeURIComponent(id)}`, signal);
  }
}

function mergedDefaults(): AdminFilters {
  return { page: 1, pageSize: 25, granularity: "day" };
}
