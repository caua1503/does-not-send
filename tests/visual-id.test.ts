import { describe, it, expect } from "vitest";
import { generateVisualId } from "../src/session/visual-id.js";

describe("generateVisualId", () => {
  it("garante unicidade entre sessões ativas rejeitando colisões (máx 10 tentativas)", () => {
    const activeIds = new Set(["AAAAAA", "BBBBBB"]);
    const id = generateVisualId(activeIds);
    expect(activeIds.has(id)).toBe(false);
  });

  it("lança erro se exceder 10 tentativas de colisão", () => {
    // Força colisão passando gerador que colide
    const mockActive = {
      has: (_: string) => true,
    } as unknown as Set<string>;

    expect(() => generateVisualId(mockActive)).toThrow(/visual id collision/i);
  });
});
