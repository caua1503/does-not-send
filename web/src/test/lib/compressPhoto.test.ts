import { describe, it, expect, vi, beforeEach } from "vitest";
import imageCompression from "browser-image-compression";
import {
  compressPhoto,
  isCompressiblePhoto,
  CompressionQueue,
  COMPRESSION_THRESHOLD_BYTES,
} from "../../lib/compressPhoto.ts";

vi.mock("browser-image-compression", () => {
  return {
    default: vi.fn(),
  };
});

describe("compressPhoto", () => {
  const mockImageCompression = vi.mocked(imageCompression);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createFakeFile = (
    name: string,
    sizeBytes: number,
    type: string
  ): File => {
    const buffer = new Uint8Array(sizeBytes);
    return new File([buffer], name, { type });
  };

  it("não-imagem passa direto sem chamar imageCompression", async () => {
    const pdfFile = createFakeFile("documento.pdf", 3 * 1024 * 1024, "application/pdf");
    const result = await compressPhoto(pdfFile);

    expect(result).toBe(pdfFile);
    expect(mockImageCompression).not.toHaveBeenCalled();
  });

  it("arquivo pequeno (<= 1.2 MB) passa direto sem chamar imageCompression", async () => {
    const smallPhoto = createFakeFile("foto.jpg", 1 * 1024 * 1024, "image/jpeg");
    const result = await compressPhoto(smallPhoto);

    expect(result).toBe(smallPhoto);
    expect(mockImageCompression).not.toHaveBeenCalled();
  });

  it("arquivo no limite exato de 1.2 MB passa direto", async () => {
    const exactLimitPhoto = createFakeFile(
      "foto-limite.jpg",
      COMPRESSION_THRESHOLD_BYTES,
      "image/jpeg"
    );
    const result = await compressPhoto(exactLimitPhoto);

    expect(result).toBe(exactLimitPhoto);
    expect(mockImageCompression).not.toHaveBeenCalled();
  });

  it("foto > 1.2 MB comprime com opções corretas e retorna arquivo comprimido", async () => {
    const originalPhoto = createFakeFile(
      "foto-grande.jpg",
      3 * 1024 * 1024,
      "image/jpeg"
    );
    const compressedPhoto = createFakeFile(
      "foto-grande.jpg",
      900 * 1024,
      "image/jpeg"
    );

    mockImageCompression.mockResolvedValueOnce(compressedPhoto);

    const result = await compressPhoto(originalPhoto);

    expect(mockImageCompression).toHaveBeenCalledTimes(1);
    const [calledFile, calledOptions] = mockImageCompression.mock.calls[0];
    expect(calledFile).toBe(originalPhoto);
    expect(calledOptions).toMatchObject({
      maxSizeMB: 1,
      maxWidthOrHeight: 2560,
      initialQuality: 0.85,
      useWebWorker: true,
      fileType: "image/jpeg",
      preserveExif: false,
    });
    expect(result).toBe(compressedPhoto);
  });

  it("se o resultado for maior ou igual ao original, retorna o original", async () => {
    const originalPhoto = createFakeFile(
      "foto.jpg",
      2 * 1024 * 1024,
      "image/jpeg"
    );
    const largerPhoto = createFakeFile(
      "foto.jpg",
      2.1 * 1024 * 1024,
      "image/jpeg"
    );

    mockImageCompression.mockResolvedValueOnce(largerPhoto);

    const result = await compressPhoto(originalPhoto);

    expect(result).toBe(originalPhoto);
  });

  it("se o type mudar após a compressão, retorna o original", async () => {
    const originalPhoto = createFakeFile(
      "foto.jpg",
      2 * 1024 * 1024,
      "image/jpeg"
    );
    const wrongTypePhoto = createFakeFile(
      "foto.png",
      800 * 1024,
      "image/png"
    );

    mockImageCompression.mockResolvedValueOnce(wrongTypePhoto);

    const result = await compressPhoto(originalPhoto);

    expect(result).toBe(originalPhoto);
  });

  it("se a compressão falhar, retorna o original e segue sem travar", async () => {
    const originalPhoto = createFakeFile(
      "foto.jpg",
      2 * 1024 * 1024,
      "image/jpeg"
    );

    mockImageCompression.mockRejectedValueOnce(new Error("Worker crashed"));

    const result = await compressPhoto(originalPhoto);

    expect(result).toBe(originalPhoto);
  });

  it("se a compressão der timeout, retorna o original e não trava o fluxo", async () => {
    const originalPhoto = createFakeFile(
      "foto.jpg",
      2 * 1024 * 1024,
      "image/jpeg"
    );

    mockImageCompression.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                createFakeFile("foto.jpg", 800 * 1024, "image/jpeg")
              ),
            200
          );
        })
    );

    const result = await compressPhoto(originalPhoto, { timeoutMs: 30 });

    expect(result).toBe(originalPhoto);
  });

  it("fila respeita o limite de 2 em paralelo ao comprimir fotos", async () => {
    const queue = new CompressionQueue(2);
    let active = 0;
    let maxActive = 0;

    mockImageCompression.mockImplementation(async (file: File) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      return createFakeFile(file.name, 800 * 1024, file.type);
    });

    const files = [
      createFakeFile("foto1.jpg", 2 * 1024 * 1024, "image/jpeg"),
      createFakeFile("foto2.jpg", 2 * 1024 * 1024, "image/jpeg"),
      createFakeFile("foto3.jpg", 2 * 1024 * 1024, "image/jpeg"),
      createFakeFile("foto4.jpg", 2 * 1024 * 1024, "image/jpeg"),
    ];

    const results = await Promise.all(
      files.map((f) => compressPhoto(f, { queue }))
    );

    expect(maxActive).toBe(2);
    expect(results.length).toBe(4);
    for (const res of results) {
      expect(res.size).toBe(800 * 1024);
    }
  });

  it("isCompressiblePhoto identifica corretamente fotos > 1.2 MB", () => {
    expect(
      isCompressiblePhoto(
        createFakeFile("test.jpg", 1.5 * 1024 * 1024, "image/jpeg")
      )
    ).toBe(true);

    expect(
      isCompressiblePhoto(
        createFakeFile("test.png", 1.5 * 1024 * 1024, "image/png")
      )
    ).toBe(true);

    expect(
      isCompressiblePhoto(
        createFakeFile("test.jpg", 1 * 1024 * 1024, "image/jpeg")
      )
    ).toBe(false);

    expect(
      isCompressiblePhoto(
        createFakeFile("test.pdf", 2 * 1024 * 1024, "application/pdf")
      )
    ).toBe(false);
  });
});
