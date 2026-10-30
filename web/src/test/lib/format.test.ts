import { describe, it, expect } from "vitest";
import { formatBytes, fileCategory, overallProgress, fileStateLabel } from "../../lib/format.ts";

describe("formatBytes", () => {
  it("formata bytes", () => expect(formatBytes(500)).toBe("500 B"));
  it("formata KB", () => expect(formatBytes(1024)).toBe("1,0 KB"));
  it("formata MB", () => expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB"));
  it("formata GB", () => expect(formatBytes(2 * 1024 ** 3)).toBe("2,0 GB"));
  it("formata 0 bytes", () => expect(formatBytes(0)).toBe("0 B"));
});

describe("fileCategory", () => {
  it("imagem por mimeType", () => expect(fileCategory("image/jpeg", "foto.jpg")).toBe("image"));
  it("vídeo por mimeType", () => expect(fileCategory("video/mp4", "video.mp4")).toBe("video"));
  it("áudio por mimeType", () => expect(fileCategory("audio/mpeg", "song.mp3")).toBe("audio"));
  it("pdf por mimeType", () => expect(fileCategory("application/pdf", "doc.pdf")).toBe("pdf"));
  it("outro por mimeType", () => expect(fileCategory("application/zip", "arq.zip")).toBe("other"));
  it("imagem por extensão fallback", () =>
    expect(fileCategory("application/octet-stream", "foto.PNG")).toBe("image"));
});

describe("overallProgress", () => {
  it("zero quando sem arquivos", () => expect(overallProgress([])).toBe(0));
  it("calcula progresso parcial", () => {
    const files = [
      { size: 100, bytesReceived: 50, state: "receiving" as const },
      { size: 100, bytesReceived: 100, state: "completed" as const },
    ];
    expect(overallProgress(files)).toBeCloseTo(0.75);
  });
  it("1 quando todos concluídos", () => {
    const files = [{ size: 100, bytesReceived: 100, state: "completed" as const }];
    expect(overallProgress(files)).toBe(1);
  });
  it("1 quando size=0", () => {
    const files = [{ size: 0, bytesReceived: 0, state: "completed" as const }];
    expect(overallProgress(files)).toBe(1);
  });
});

describe("fileStateLabel", () => {
  it("receiving", () => expect(fileStateLabel("receiving")).toBe("Recebendo…"));
  it("completed", () => expect(fileStateLabel("completed")).toBe("Concluído"));
  it("failed", () => expect(fileStateLabel("failed")).toBe("Falhou"));
});
