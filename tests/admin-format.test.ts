import { describe, expect, it } from "vitest";
import {
  formatBucketLabel,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatDate,
  formatTime,
} from "../src/shared/admin/format.js";

describe("formatBytes (base 1024)", () => {
  it("bordas: 0, negativo e bytes pequenos sem casa decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("1023 ainda é B; 1024 vira KB com uma casa", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1,0 KB");
    expect(formatBytes(1536)).toBe("1,5 KB");
  });

  it("MB/GB/TB usam o divisor correto (sem confundir 1000 e 1024)", () => {
    expect(formatBytes(1024 * 1024)).toBe("1,0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1,0 GB");
    expect(formatBytes(1024 ** 4)).toBe("1,0 TB");
    expect(formatBytes(1024 ** 4 + 512 * 1024 ** 3)).toBe("1,5 TB");
  });

  it("rejeita NaN e infinito como 0 B", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("formatNumber", () => {
  it("agrupa milhares em pt-BR e trata não-numéricos", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(Number.NaN)).toBe("0");
  });
});

describe("datas com Intl e ADMIN_TZ", () => {
  const instant = "2026-11-06T00:30:00.000Z";

  it("mesmo instante muda por fuso (America/Sao_Paulo = -3)", () => {
    expect(formatDateTime(instant, "America/Sao_Paulo")).toBe("05/11/2026 21:30");
    expect(formatDateTime(instant, "UTC")).toBe("06/11/2026 00:30");
  });

  it("formatDate mostra só o dia, formatTime só o horário", () => {
    expect(formatDate(instant, "America/Sao_Paulo")).toBe("05/11/2026");
    expect(formatTime(instant, "UTC")).toBe("00:30:00");
  });

  it("fuso de meio do mundo (Tokyo) não cai no default", () => {
    expect(formatDateTime(instant, "Asia/Tokyo")).toBe("06/11/2026 09:30");
  });

  it("entrada inválida vira — em vez de quebrar", () => {
    expect(formatDateTime("não é data")).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatBucketLabel("lixo", "day")).toBe("—");
  });
});

describe("formatBucketLabel", () => {
  it("dia mostra d/m abreviado; mês mostra mês/ano; ano mostra só ano", () => {
    expect(formatBucketLabel("2026-11-05T00:00:00.000Z", "day", "UTC")).toBe("05 nov");
    expect(formatBucketLabel("2026-03-01T00:00:00.000Z", "month", "UTC")).toBe("mar 26");
    expect(formatBucketLabel("2026-03-01T00:00:00.000Z", "year", "UTC")).toBe("26");
  });
});
