import { describe, it, expect } from "vitest";
import { normalizeIp, extractExtension, categorize } from "../src/recording/normalize.js";

describe("normalizeIp", () => {
  it("strips ::ffff: prefix, normalizes case and returns null for empty or undefined", () => {
    expect(normalizeIp("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe("extractExtension", () => {
  it("extracts extension and converts to lowercase", () => {
    expect(extractExtension("file.TXT")).toBe("txt");
    expect(extractExtension("document.PDF")).toBe("pdf");
    expect(extractExtension("image.JpG")).toBe("jpg");
  });

  it("returns empty string if no extension", () => {
    expect(extractExtension("README")).toBe("");
    expect(extractExtension("no-ext")).toBe("");
  });

  it("handles multiple dots (takes last)", () => {
    expect(extractExtension("archive.tar.gz")).toBe("gz");
    expect(extractExtension("file.backup.zip")).toBe("zip");
  });

  it("handles extension with numbers and hyphens", () => {
    expect(extractExtension("file.mp3")).toBe("mp3");
    expect(extractExtension("archive.7z")).toBe("7z");
  });

  it("returns empty if ends with dot", () => {
    expect(extractExtension("file.")).toBe("");
  });
});

describe("categorize", () => {
  it.each([
    ["jpg", "image/jpeg", "images"],
    ["png", "image/png", "images"],
    ["mp4", "video/mp4", "videos"],
    ["mkv", "video/x-matroska", "videos"],
    ["mp3", "audio/mpeg", "audios"],
    ["wav", "audio/wav", "audios"],
    ["pdf", "application/pdf", "pdfs"],
    ["doc", "application/msword", "documents"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "documents"],
    ["zip", "application/zip", "archives"],
    ["tar", "application/x-tar", "archives"],
  ])("maps extension %s with mime %s to %s", (ext, mime, expected) => {
    expect(categorize(ext, mime)).toBe(expected);
  });

  it.each([
    ["", "image/png", "images"],
    ["", "video/mp4", "videos"],
    ["", "audio/mpeg", "audios"],
    ["", "application/pdf", "pdfs"],
    ["", "text/plain", "other"],
  ])("falls back to MIME prefix when extension is %s", (ext, mime, expected) => {
    expect(categorize(ext, mime)).toBe(expected);
  });

  it("extension wins over MIME", () => {
    expect(categorize("jpg", "text/plain")).toBe("images");
    expect(categorize("mp4", "application/octet-stream")).toBe("videos");
    expect(categorize("pdf", "text/html")).toBe("pdfs");
  });

  it("returns other for unknown extension and MIME", () => {
    expect(categorize("", "application/octet-stream")).toBe("other");
    expect(categorize("unknown", "application/x-unknown")).toBe("other");
    expect(categorize("xyz", "foo/bar")).toBe("other");
  });
});
