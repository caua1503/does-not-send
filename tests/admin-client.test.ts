import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, AdminClient } from "../src/shared/admin/client.js";

function jsonFetch(status: number, body: unknown, headers?: Record<string, string>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }) as unknown as Response;
  });
}

describe("AdminClient", () => {
  it("monta a query a partir dos filtros e envia credentials same-origin", async () => {
    const fetchFn = jsonFetch(200, { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
    const client = new AdminClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.transfers({ status: "completed", pageSize: 50, page: 2 });
    // Que bug real pega: regredir a query perderia filtros na hora de listar.
    const [url, init] = (fetchFn as ReturnType<typeof jsonFetch>).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain(
      "/admin/api/transfers?status=completed&page=2&pageSize=50",
    );
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toMatchObject({ accept: "application/json" });
  });

  it("converte 429 em AdminApiError com código da API", async () => {
    const fetchFn = jsonFetch(429, { error: { code: "too_many_attempts", message: "" } });
    const client = new AdminClient({ fetchFn: fetchFn as unknown as typeof fetch });
    // Que bug real pega: tratar 429 como 500 quebraria a mensagem do login.
    await expect(client.login("admin", "bad")).rejects.toMatchObject({
      status: 429,
      code: "too_many_attempts",
    });
  });

  it("401 aciona onUnauthorized e erros JSON malformado normalizam", async () => {
    const onUnauthorized = vi.fn();
    const calls: Array<{ status: number; body?: string }> = [
      { status: 401 },
      { status: 503, body: "html de gateway" },
    ];
    let i = 0;
    const client = new AdminClient({
      fetchFn: (async () => {
        const call = calls[i++]!;
        return new Response(call.body ?? "", { status: call.status });
      }) as unknown as typeof fetch,
      onUnauthorized,
    });
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await expect(client.me()).rejects.toMatchObject({ status: 503, code: "unknown" });
  });

  it("resposta vazia vira undefined (logout 204) e AbortError não é tragado", async () => {
    const client = new AdminClient({
      fetchFn: (async () => new Response("", { status: 204 })) as unknown as typeof fetch,
    });
    await expect(client.logout()).resolves.toBeUndefined();

    const aborting = new AdminClient({
      fetchFn: (async () => {
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(aborting.me()).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("AdminApiError", () => {
  it("usa a mensagem da API e cai para o código quando vazia", () => {
    expect(new AdminApiError({ status: 503, code: "db_unavailable", message: "foo" }).message).toBe("foo");
    expect(new AdminApiError({ status: 503, code: "db_unavailable", message: "" }).message).toBe("db_unavailable");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
