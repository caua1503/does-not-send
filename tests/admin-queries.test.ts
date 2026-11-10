import { describe, expect, it } from "vitest";
import { escapeLike, fillBuckets, likePattern, parseDirection, parseSort } from "../src/admin/queries.js";
import { buildBuckets } from "../src/admin/time-buckets.js";
import { MAX_BUCKETS } from "../src/shared/admin/types.js";

describe("busca ILIKE", () => {
  it("escapa %, _ e \\ para a busca ser literal", () => {
    // Que bug pega: busca por "50%" viraria curinga e traria tudo; "_" casaria qualquer caractere.
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\temp")).toBe("c:\\\\temp");
    expect(likePattern("a%b")).toBe("%a\\%b%");
  });

  it("escapa a barra invertida antes do curinga que ela introduz", () => {
    // Que bug pega: escapar %/% antes de \\ deixaria "\\%" escapado duas vezes (busca errada).
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});

describe("ordenação em whitelist", () => {
  it("aceita só chaves permitidas, com fallback seguro", () => {
    // Que bug pega: sort=vindo-da-URL injetado no ORDER BY.
    expect(parseSort("size", ["size", "name"], "name")).toBe("size");
    expect(parseSort("size; DROP TABLE transfers", ["size", "name"], "name")).toBe("name");
    expect(parseSort(undefined, ["size"], "size")).toBe("size");
    expect(parseDirection("ASC", "desc")).toBe("desc");
    expect(parseDirection("asc", "desc")).toBe("asc");
  });
});

describe("buildBuckets", () => {
  const tz = "America/Sao_Paulo";

  it("dias inteiros no fuso, buckets contíguos e o último termina no 'to'", () => {
    const from = new Date("2026-03-01T00:00:00-03:00");
    const to = new Date("2026-03-03T12:00:00-03:00");
    const buckets = buildBuckets(from, to, "day", tz);
    expect(buckets.map((b) => b.bucketStart)).toEqual([
      "2026-03-01T03:00:00.000Z",
      "2026-03-02T03:00:00.000Z",
      "2026-03-03T03:00:00.000Z",
    ]);
    for (let i = 1; i < buckets.length; i++) {
      expect(Date.parse(buckets[i]!.bucketStart)).toBe(Date.parse(buckets[i - 1]!.bucketEnd) + 1);
    }
  });

  it("semana começa na segunda-feira", () => {
    // Que bug pega: semanas começando no domingo deslocariam o gráfico semanal.
    const buckets = buildBuckets(
      new Date("2026-03-04T12:00:00-03:00"), // quarta
      new Date("2026-03-18T12:00:00-03:00"),
      "week",
      tz,
    );
    expect(buckets).toHaveLength(3);
    // Primeiro bucket é cortado no "from"; a semana seguinte começa na segunda 09/03.
    expect(buckets[0]!.bucketStart).toBe("2026-03-04T15:00:00.000Z");
    expect(buckets[1]!.bucketStart).toBe("2026-03-09T03:00:00.000Z");
  });

  it("mês e ano usam calendário do fuso e nunca passam de 400 buckets", () => {
    const months = buildBuckets(new Date("2025-11-20T12:00:00Z"), new Date("2026-02-02T12:00:00Z"), "month", tz);
    expect(months.map((b) => b.bucketStart)).toEqual([
      "2025-11-20T12:00:00.000Z", // primeiro mês cortado no "from"

      "2025-12-01T03:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
      "2026-02-01T03:00:00.000Z",
    ]);
    // 2023-01-01T00:00Z ainda é 2022-12-31 em São Paulo: o ano começa em 2022.
    const years = buildBuckets(new Date("2023-01-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"), "year", tz);
    expect(years).toHaveLength(5);
    expect(years[0]!.bucketStart).toBe("2023-01-01T00:00:00.000Z");
    const wide = buildBuckets(new Date("2010-01-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"), "day", tz);
    expect(wide).toHaveLength(MAX_BUCKETS);
    expect(wide[wide.length - 1]!.bucketEnd).toBe("2026-06-01T02:59:59.999Z");
  });
});

describe("fillBuckets", () => {
  it("preenche buckets vazios com zero e ignora linhas fora", () => {
    // Que bug pega: dias sem transferência sumindo do eixo do gráfico.
    const buckets = [
      { bucketStart: "2026-01-01T03:00:00.000Z", bucketEnd: "2026-01-02T02:59:59.999Z" },
      { bucketStart: "2026-01-02T03:00:00.000Z", bucketEnd: "2026-01-03T02:59:59.999Z" },
    ];
    const points = fillBuckets(buckets, [
      { bucket: "2026-01-02T03:00:00.000Z", volumeBytes: 100, transfers: 2 },
      { bucket: "2026-01-09T03:00:00.000Z", volumeBytes: 999, transfers: 9 },
    ]);
    expect(points).toEqual([
      { ...buckets[0], volumeBytes: 0, transfers: 0 },
      { ...buckets[1], volumeBytes: 100, transfers: 2 },
    ]);
  });
});
