import { describe, expect, it } from "vitest";
import {
  defaultFilters,
  parseAdminFilters,
  resolvePeriod,
  serializeAdminFilters,
} from "../src/shared/admin/filters.js";

describe("parseAdminFilters", () => {
  it("retorna defaults sem query string", () => {
    const { filters, warnings } = parseAdminFilters("");
    expect(filters).toEqual(defaultFilters());
    expect(warnings).toEqual([]);
  });

  it("parseia todos os filtros válidos", () => {
    const { filters, warnings } = parseAdminFilters(
      new URLSearchParams({
        from: "2026-01-02T03:04:05Z",
        to: "2026-01-03T00:00:00Z",
        ip: "192.168.0.7",
        session: "abc123",
        category: "images",
        status: "completed",
        minSize: "1024",
        maxSize: "9999",
        q: "  relatório anual  ",
        page: "3",
        pageSize: "50",
        granularity: "week",
      }),
    );
    expect(warnings).toEqual([]);
    expect(filters).toEqual({
      from: "2026-01-02T03:04:05.000Z",
      to: "2026-01-03T00:00:00.000Z",
      ip: "192.168.0.7",
      session: "abc123",
      category: "images",
      status: "completed",
      minSize: 1024,
      maxSize: 9999,
      q: "relatório anual",
      page: 3,
      pageSize: 50,
      granularity: "week",
    });
  });

  it("descarta entradas inválidas com aviso, sem falhar", () => {
    const { filters, warnings } = parseAdminFilters(
      new URLSearchParams({
        from: "ontem",
        to: "2026-99-99",
        category: "hack#er",
        status: "deleted",
        minSize: "-3",
        pageSize: "100000",
        granularity: "hour",
        page: "0",
      }),
    );
    expect(warnings).toEqual(
      expect.arrayContaining(["from", "to", "category", "status", "minSize", "pageSize", "granularity", "page"]),
    );
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    expect(filters.category).toBeUndefined();
    expect(filters.status).toBeUndefined();
    expect(filters.minSize).toBeUndefined();
    expect(filters.pageSize).toBe(100);
    expect(filters.granularity).toBe("day");
    expect(filters.page).toBe(1);
  });

  it("inverte from/to quando from vem depois de to", () => {
    const { filters, warnings } = parseAdminFilters("from=2026-02-02&to=2026-01-01");
    expect(warnings).toContain("from");
    expect(filters.from).toBe("2026-01-01");
    expect(filters.to).toBe("2026-02-02");
  });

  it("troca minSize/maxSize quando invertidos", () => {
    const { filters } = parseAdminFilters("minSize=5000&maxSize=100");
    expect(filters.minSize).toBe(100);
    expect(filters.maxSize).toBe(5000);
  });

  it("limpa caracteres de controle e limita o tamanho de textos", () => {
    const { filters } = parseAdminFilters(`ip=10.0.0.1\u0000x&q=${"a".repeat(200)}`);
    expect(filters.ip).toBe("10.0.0.1x");
    expect(filters.q).toBeUndefined();
  });
});

describe("ida e volta parse/serialize", () => {
  it("roundtrip preserva todos os filtros", () => {
    const query = "from=2026-01-02T03:04:05Z&ip=10.1.2.3&category=videos&status=failed&minSize=1&maxSize=2&q=nota&page=2&pageSize=100&granularity=year";
    const first = parseAdminFilters(query);
    expect(first.warnings).toEqual([]);
    const second = parseAdminFilters(serializeAdminFilters(first.filters));
    expect(second.filters).toEqual(first.filters);
    expect(second.warnings).toEqual([]);
  });

  it("serialize omite defaults e valores ausentes", () => {
    const s = serializeAdminFilters(defaultFilters());
    expect(s).toBe("");
    expect(serializeAdminFilters({ ...defaultFilters(), page: 2 })).toBe("page=2");
  });
});

describe("datas inválidas no calendário", () => {
  it("descarta 2026-02-30 (Date.parse rolava para março)", () => {
    // Que bug pega: from=2026-02-30 virava 02/03 silenciosamente.
    const { filters, warnings } = parseAdminFilters("from=2026-02-30&to=2026-03-05");
    expect(filters.from).toBeUndefined();
    expect(warnings).toContain("from");
    expect(filters.to).toBe("2026-03-05");
  });
});

describe("resolvePeriod", () => {
  it("usa limites explícitos", () => {
    const period = resolvePeriod(
      { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" },
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(period.from).toBe("2026-01-01T00:00:00.000Z");
    expect(period.to).toBe("2026-01-31T00:00:00.000Z");
  });

  it("to ausente vira agora; from ausente vira to - 30 dias", () => {
    const now = new Date("2026-11-06T12:00:00.000Z");
    const none = resolvePeriod({}, now);
    expect(none.to).toBe("2026-11-06T12:00:00.000Z");
    expect(none.from).toBe("2026-10-07T12:00:00.000Z");
    const explicitTo = resolvePeriod({ to: "2026-03-10T00:00:00.000Z" }, now);
    expect(explicitTo.from).toBe("2026-02-08T00:00:00.000Z");
    const explicitFrom = resolvePeriod({ from: "2026-03-01T00:00:00.000Z" }, now);
    expect(explicitFrom.to).toBe("2026-11-06T12:00:00.000Z");
  });
});

describe("resolvePeriod e fusos", () => {
  it("datas 'YYYY-MM-DD' viram o dia inteiro em ADMIN_TZ, não em UTC", () => {
    // Que bug pega: from=2026-01-01 perderia as 3 primeiras horas do dia em São Paulo.
    const now = new Date("2026-06-01T00:00:00Z");
    const period = resolvePeriod({ from: "2026-01-01", to: "2026-01-01" }, now, "America/Sao_Paulo");
    expect(period).toEqual({
      from: "2026-01-01T03:00:00.000Z",
      to: "2026-01-02T02:59:59.999Z",
    });
  });

  it("data simples fica como 'YYYY-MM-DD' (não vira meia-noite UTC)", () => {
    // Que bug pega: parseAdminFilters convertendo "2026-01-06" em ISO UTC antes do resolvePeriod,
    // esticando o filtro 21:00 do dia anterior no horário de São Paulo.
    const { filters, warnings } = parseAdminFilters("from=2026-01-06&to=2026-01-06");
    expect(warnings).toEqual([]);
    expect(filters.from).toBe("2026-01-06");
    expect(filters.to).toBe("2026-01-06");
  });

  it("sem bounds, usa os últimos 30 dias terminando em agora", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    const { from, to } = resolvePeriod({}, now);
    expect(to).toBe("2026-03-31T12:00:00.000Z");
    expect(Date.parse(to) - Date.parse(from)).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
