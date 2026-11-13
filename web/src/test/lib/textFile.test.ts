import { describe, it, expect } from "vitest";
import { buildTextFile, textFileName, TEXT_MAX_LENGTH } from "../../lib/textFile.ts";

describe("textFile", () => {
  const date = new Date(2026, 0, 1, 14, 32, 5);

  it("gera nome no formato Texto HH-MM-SS.txt", () => {
    expect(textFileName(date, [])).toBe("Texto 14-32-05.txt");
  });

  it("adiciona sufixo numérico para nomes repetidos", () => {
    expect(textFileName(date, ["Texto 14-32-05.txt"])).toBe("Texto 14-32-05 (2).txt");
    expect(
      textFileName(date, ["Texto 14-32-05.txt", "Texto 14-32-05 (2).txt"]),
    ).toBe("Texto 14-32-05 (3).txt");
  });

  it("gera arquivo .txt com tamanho UTF-8 correto", () => {
    const text = "olá mundo";
    const file = buildTextFile(text, date, []);

    expect(file.name).toBe("Texto 14-32-05.txt");
    expect(file.type).toBe("text/plain; charset=utf-8");
    expect(file.size).toBe(new TextEncoder().encode(text).length);
  });

  it("expõe o limite de caracteres usado pelo widget", () => {
    expect(TEXT_MAX_LENGTH).toBe(10_000);
  });
});
