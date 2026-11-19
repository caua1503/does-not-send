import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runImageWorker } from "../../lib/imageWorker.ts";
import { convertHeicToJpeg, isHeic } from "../../lib/convertHeic.ts";

vi.mock("../../lib/imageWorker.ts", () => ({ runImageWorker: vi.fn() }));
const convertInWorker = vi.mocked(runImageWorker);

function makeFile(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
}

describe("isHeic", () => {
  it("detecta por MIME image/heic e image/heif", () => {
    expect(isHeic(makeFile("IMG.HEIC", "image/heic"))).toBe(true);
    expect(isHeic(makeFile("IMG.HEIF", "image/heif"))).toBe(true);
  });
  it("detecta por extensão quando MIME genérico", () => {
    expect(isHeic(makeFile("IMG_0001.heic", ""))).toBe(true);
    expect(isHeic(makeFile("IMG_0001.HEIF", "application/octet-stream"))).toBe(true);
  });
  it("ignora não-HEIC", () => {
    expect(isHeic(makeFile("foto.jpg", "image/jpeg"))).toBe(false);
    expect(isHeic(makeFile("video.mp4", "video/mp4"))).toBe(false);
    expect(isHeic(makeFile("relatorio.heicx", "application/pdf"))).toBe(false);
  });
});

describe("convertHeicToJpeg", () => {
  beforeEach(() => {
    convertInWorker.mockReset();
    vi.stubGlobal("Worker", class {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it("não chama a lib para arquivos não-HEIC e devolve o mesmo File", async () => {
    const file = makeFile("foto.jpg", "image/jpeg");
    await expect(convertHeicToJpeg(file)).resolves.toBe(file);
    expect(convertInWorker).not.toHaveBeenCalled();
  });

  it("converte HEIC para File JPEG com extensão .jpg e type image/jpeg", async () => {
    convertInWorker.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
    const file = makeFile("IMG_1234.HEIC", "image/heic");

    const out = await convertHeicToJpeg(file);

    expect(convertInWorker).toHaveBeenCalledWith(expect.anything(), file, 60_000);
    expect(out.name).toBe("IMG_1234.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(out.lastModified).toBe(1234);
    expect(out.size).toBe(3);
  });

  it("propaga falha da conversão", async () => {
    convertInWorker.mockRejectedValue(new Error("libheif error"));
    await expect(convertHeicToJpeg(makeFile("a.heic", "image/heic"))).rejects.toThrow(
      "libheif error",
    );
  });
});
