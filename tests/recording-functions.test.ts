import { describe, test, expect } from "vitest";
import {
  normalizeIp,
  parseUserAgent,
  categorize,
  sanitizeFileName,
} from "../src/recording/functions.js";

describe("normalizeIp", () => {
  test("remove prefixo ::ffff: de IPv4-mapped", () => {
    expect(normalizeIp("::ffff:192.168.1.100")).toBe("192.168.1.100");
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  test("mantém endereços IPv6 puros", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  test("mantém endereços IPv4 puros", () => {
    expect(normalizeIp("192.168.1.1")).toBe("192.168.1.1");
  });
});

describe("parseUserAgent", () => {
  test("detecta Chrome Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toBe("Chrome (Android)");
  });

  test("detecta Safari iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("Safari (iOS)");
  });

  test("detecta Firefox desktop Linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
    expect(parseUserAgent(ua)).toBe("Firefox (Linux)");
  });

  test("detecta Edge Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUserAgent(ua)).toBe("Edge (Windows)");
  });

  test("retorna Unknown para UA não reconhecido", () => {
    expect(parseUserAgent("CustomBot/1.0")).toBe("Unknown");
  });
});

describe("categorize", () => {
  test("prioriza extensão sobre MIME", () => {
    expect(categorize("JPG", "image/jpeg")).toBe("images");
    expect(categorize("Mp4", "video/mp4")).toBe("videos");
  });

  test("fallback para MIME quando extensão não reconhecida", () => {
    expect(categorize("unknown", "image/webp")).toBe("images");
    expect(categorize("xyz", "video/quicktime")).toBe("videos");
    expect(categorize("abc", "audio/mpeg")).toBe("audios");
  });

  test("categoriza PDFs corretamente", () => {
    expect(categorize("pdf", "application/pdf")).toBe("pdfs");
  });

  test("categoriza documentos Office", () => {
    expect(categorize("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("documents");
    expect(categorize("xlsx", "application/vnd.ms-excel")).toBe("documents");
  });

  test("categoriza archives", () => {
    expect(categorize("zip", "application/zip")).toBe("archives");
    expect(categorize("tar", "application/x-tar")).toBe("archives");
  });

  test("retorna other quando não reconhece nem extensão nem MIME", () => {
    expect(categorize("unknown", "application/octet-stream")).toBe("other");
  });
});

describe("sanitizeFileName", () => {
  test("retorna basename de caminho Unix", () => {
    expect(sanitizeFileName("/home/user/docs/report.pdf")).toBe("report.pdf");
  });

  test("retorna basename de caminho Windows", () => {
    expect(sanitizeFileName("C:\\Users\\Admin\\file.txt")).toBe("file.txt");
  });

  test("remove caracteres de controle", () => {
    expect(sanitizeFileName("file\x00name\x1F.txt")).toBe("filename.txt");
    expect(sanitizeFileName("test\x7Ffile.pdf")).toBe("testfile.pdf");
  });

  test("trunca nomes longos em 255 caracteres", () => {
    const longName = "a".repeat(300) + ".txt";
    const result = sanitizeFileName(longName);
    expect(result.length).toBe(255);
  });

  test("preserva nomes válidos simples", () => {
    expect(sanitizeFileName("simple.txt")).toBe("simple.txt");
    expect(sanitizeFileName("My Document (2024).pdf")).toBe("My Document (2024).pdf");
  });
});
