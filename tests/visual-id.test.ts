import { describe, it, expect } from "vitest";
import { generateVisualId, VISUAL_ID_CHARSET } from "../src/session/visual-id.js";

describe("generateVisualId", () => {
  it("tem exatamente 6 caracteres", () => {
    const id = generateVisualId();
    expect(id).toHaveLength(6);
  });

  it("alfabeto contém exatamente 31 símbolos sem ambíguos", () => {
    expect(VISUAL_ID_CHARSET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(VISUAL_ID_CHARSET).toHaveLength(31);
    // Não contém I, L, O, 0, 1
    expect(VISUAL_ID_CHARSET).not.toMatch(/[ILO01]/);
  });

  it("usa apenas caracteres do alfabeto especificado", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateVisualId();
      for (const char of id) {
        expect(VISUAL_ID_CHARSET).toContain(char);
      }
    }
  });

  it("garante unicidade entre sessões ativas rejeitando colisões (máx 10 tentativas)", () => {
    const activeIds = new Set(["AAAAAA", "BBBBBB"]);
    const id = generateVisualId(activeIds);
    expect(activeIds.has(id)).toBe(false);

    // Se houver colisão simulada com activeIds cobrindo quase tudo
    const collisionsSet = new Set<string>();
    // Preenche com ids gerados
    for (let i = 0; i < 50; i++) {
      collisionsSet.add(generateVisualId(collisionsSet));
    }
    expect(collisionsSet.size).toBe(50);
  });

  it("lança erro se exceder 10 tentativas de colisão", () => {
    // Força colisão passando gerador que colide
    const mockActive = {
      has: (_: string) => true,
    } as unknown as Set<string>;

    expect(() => generateVisualId(mockActive)).toThrow(/visual id collision/i);
  });

  it("único entre 1000 sessões geradas e diferente de tokens", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateVisualId(set);
      set.add(id);
    }
    expect(set.size).toBe(1000);
  });
});
