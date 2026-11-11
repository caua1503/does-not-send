import { describe, it, expect } from "vitest";
import { previewUrl, downloadUrl } from "../../lib/api.ts";

describe("file urls", () => {
  it("acrescenta &v=<version> no preview e no download", () => {
    expect(previewUrl("s1", "f1", "tok", 3)).toMatch(/\/preview\?token=tok&v=3$/);
    expect(downloadUrl("s1", "f1", "tok", 2)).toMatch(/\/download\?token=tok&v=2$/);
  });

  it("omite v quando a versão é desconhecida", () => {
    expect(previewUrl("s1", "f1", "tok")).not.toContain("v=");
    expect(downloadUrl("s1", "f1", "tok")).not.toContain("v=");
  });
});
