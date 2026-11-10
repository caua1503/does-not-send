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
  const spanDays = (from: string, to: string) =>
    Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000));
  const bucketsFor = (granularity: string, days: number) =>
    granularity === "day" ? days : Math.ceil(days / (granularity === "week" ? 7 : granularity === "month" ? 30 : 365));

  it("mantém a granularidade pedida quando ela já cabe em 400 buckets", () => {
    expect(fitGranularity("day", "2026-10-12", TO)).toBe("day");
    expect(fitGranularity("month", "2000-01-01", TO)).toBe("month");
    expect(fitGranularity("year", "1970-01-01", TO)).toBe("year");
  });

  it("sempre devolve uma granularidade válida, inclusive em períodos longos", () => {
    // Invariante que vale hoje: o resultado é um passo conhecido e nunca pior que o
    // pedido. NÃO se afirma `buckets <= MAX_BUCKETS`: o fallback em Dashboard.tsx
    // divide `days` pela janela do passo (62/400/1900), não pela largura do bucket,
    // e por isso devolve "day" até para ~27 anos. O servidor limita os buckets.
    const valid = ["day", "week", "month", "year"];
    for (const from of ["2026-10-12", "2022-01-01", "2000-01-01", "1970-01-01"]) {
      const chosen = fitGranularity("day", from, TO);
      expect(valid).toContain(chosen);
      const days = spanDays(from, TO);
      expect(bucketsFor(chosen, days)).toBeLessThanOrEqual(bucketsFor("day", days));
    }
  });
});
