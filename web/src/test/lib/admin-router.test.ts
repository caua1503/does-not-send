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
  // Datas fixas: o teste é de granularidade, não de "hoje".
  const TO = "2026-11-10";

  it("mantém a granularidade pedida quando ela já cabe em 400 buckets", () => {
    expect(fitGranularity("day", "2026-10-12", TO)).toBe("day");
    expect(fitGranularity("month", "2000-01-01", TO)).toBe("month");
    expect(fitGranularity("year", "1970-01-01", TO)).toBe("year");
  });

  it("engrossa a série quando 'day' estoura o limite de buckets", () => {
    // Períodos muito longos precisam de um passo mais grosso que 'day'.
    expect(fitGranularity("day", "1970-01-01", "2100-01-01")).toBe("week");
  });
});
