import { describe, expect, it } from "vitest";
import { carryFilters, hrefFor, parseHash } from "../../admin/router.ts";
import { fitGranularity } from "../../admin/pages/Dashboard.tsx";

describe("admin hash router", () => {
  it("mapeia as rotas do painel", () => {
    expect(parseHash("#/")).toMatchObject({ name: "dashboard" });
    expect(parseHash("")).toMatchObject({ name: "dashboard" });
    expect(parseHash("#/sessions?q=a")).toMatchObject({ name: "sessions" });
    expect(parseHash("#/transfers")).toMatchObject({ name: "transfers" });
    expect(parseHash("#/sessions/abc")).toEqual({ name: "session", id: "abc" });
    expect(parseHash("#/transfers/t%201")).toEqual({ name: "transfer", id: "t 1" });
    expect(parseHash("#/nada/aqui")).toEqual({ name: "unknown" });
  });

  it("monta href com query e leva filtros entre páginas", () => {
    expect(hrefFor({ path: "/sessions", query: "q=x" })).toBe("#/sessions?q=x");
    const carried = carryFilters({ page: 3, pageSize: 50, granularity: "month", ip: "10.0.0.1" });
    expect(carried.get("ip")).toBe("10.0.0.1");
    expect(carried.has("page")).toBe(false);
    expect(carried.has("granularity")).toBe(false);
  });
});

describe("fitGranularity", () => {
  const today = Date.now();
  const from = new Date(today - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(today).toISOString().slice(0, 10);
  const yearsAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  it("não deixa a série passar de 400 buckets", () => {
    // Que bug pega: período longo em dias estouraria o limite e a API recusaria.
    expect(fitGranularity("day", from, to)).toBe("day");
    expect(fitGranularity("day", yearsAgo(4), to)).toBe("week");
    expect(fitGranularity("day", yearsAgo(26), to)).toBe("month");
    expect(fitGranularity("day", yearsAgo(56), to)).toBe("year");
  });
});
