import { describe, expect, it } from "vitest";
import { MAX_ORIGINAL_SIZE_BYTES, parseOriginalSize } from "../src/utils/original-size.js";

describe("parseOriginalSize", () => {
  it("aceita inteiro >= 0 dentro do teto", () => {
    expect(parseOriginalSize("0")).toBe(0);
    expect(parseOriginalSize("5242880")).toBe(5_242_880);
    expect(parseOriginalSize(String(MAX_ORIGINAL_SIZE_BYTES))).toBe(MAX_ORIGINAL_SIZE_BYTES);
  });

  it("ausente ou inválido vira null (upload segue normalmente)", () => {
    // Que bug pega: cliente malicioso/antigo mandando lixo e quebrando o upload.
    expect(parseOriginalSize(undefined)).toBeNull();
    expect(parseOriginalSize("")).toBeNull();
    expect(parseOriginalSize("abc")).toBeNull();
    expect(parseOriginalSize("-1")).toBeNull();
    expect(parseOriginalSize("1.5")).toBeNull();
    expect(parseOriginalSize(String(MAX_ORIGINAL_SIZE_BYTES + 1))).toBeNull();
    expect(parseOriginalSize(42)).toBeNull();
  });
});
