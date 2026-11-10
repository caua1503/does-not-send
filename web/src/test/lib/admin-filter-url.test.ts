import { describe, expect, it } from "vitest";
import {
  filterKey,
  hasActiveFilters,
  parseFilterParams,
  readListSort,
  withPeriod,
  writeFilterParams,
} from "../../admin/filter-url.ts";
import { SORT_KEYS } from "../../../../src/shared/admin/sorts.ts";

describe("admin filter URL", () => {
  it("descarta valores inválidos vindos de URL editada à mão", () => {
    // Que bug pega: status/pageSize/category fora do contrato iriam à API e virariam 400.
    const filters = parseFilterParams(
      new URLSearchParams("status=nope&category=bad&pageSize=1000&page=-3&granularity=hour&minSize=-5"),
    );
    expect(filters).toEqual({ page: 1, pageSize: 25, granularity: "day" });
  });

  it("preserva filtros curtos e omite padrões ao escrever a URL", () => {
    const params = writeFilterParams(
      new URLSearchParams("sort=size&dir=asc&q=old"),
      { page: 1, pageSize: 25, granularity: "day", q: "nota" },
    );
    expect(params.get("q")).toBe("nota");
    expect(params.get("sort")).toBe("size");
    expect(params.has("page")).toBe(false);
    expect(params.has("pageSize")).toBe(false);
  });

  it("completa o período sem sobrescrever limites explícitos", () => {
    const filled = withPeriod({ page: 1, pageSize: 25, granularity: "day" }, "2026-11-10");
    expect(filled).toMatchObject({ from: "2026-10-12", to: "2026-11-10" });
    const kept = withPeriod({ page: 1, pageSize: 25, granularity: "day", from: "2026-01-01", to: "2026-01-31" }, "2026-11-10");
    expect(kept).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("só aceita as colunas de ordenação que o servidor conhece", () => {
    // Que bug pega: header novo no front mandaria um sort inexistente (silenciosamente ignorado).
    const allowed = new Set(SORT_KEYS.transfers);
    expect(allowed.has("size")).toBe(true);
    expect(readListSort(new URLSearchParams("sort=size;drop&dir=asc"), SORT_KEYS.transfers, "startedAt")).toEqual({
      sort: "startedAt",
      dir: "asc",
    });
  });

  it("filterKey muda com qualquer filtro e detecta filtros ativos", () => {
    const base = parseFilterParams(new URLSearchParams());
    expect(hasActiveFilters(base)).toBe(false);
    expect(filterKey(base)).not.toBe(filterKey({ ...base, q: "x" }));
  });
});
