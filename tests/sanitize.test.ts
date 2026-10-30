import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../src/utils/sanitize.js";

describe("sanitizeFilename", () => {
  it("passes a normal filename through", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
  });

  it("rejects empty filename", () => {
    expect(() => sanitizeFilename("")).toThrow("Empty filename");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeFilename("file\0.txt")).toThrow("null bytes");
  });

  it("rejects control characters", () => {
    expect(() => sanitizeFilename("file\x01.txt")).toThrow("control characters");
  });

  it("strips path traversal ../ to basename only", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("strips path traversal ..\\", () => {
    // After splitting by backslash, last segment is "passwd" which is fine
    expect(sanitizeFilename("..\\..\\etc\\passwd")).toBe("passwd");
  });

  it("rejects bare ..", () => {
    expect(() => sanitizeFilename("..")).toThrow("Path traversal");
  });

  it("strips directory components", () => {
    expect(sanitizeFilename("path/to/file.txt")).toBe("file.txt");
  });

  it("rejects Windows reserved names", () => {
    expect(() => sanitizeFilename("CON")).toThrow("Reserved");
    expect(() => sanitizeFilename("con.txt")).toThrow("Reserved");
    expect(() => sanitizeFilename("NUL")).toThrow("Reserved");
    expect(() => sanitizeFilename("COM1")).toThrow("Reserved");
    expect(() => sanitizeFilename("LPT1.txt")).toThrow("Reserved");
  });

  it("truncates names longer than 255 chars", () => {
    const long = "a".repeat(300) + ".txt";
    expect(sanitizeFilename(long).length).toBe(255);
  });
});
