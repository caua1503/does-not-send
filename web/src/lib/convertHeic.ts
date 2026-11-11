const HEIC_MIME_TYPES = ["image/heic", "image/heif"];
const HEIC_EXTENSIONS = [".heic", ".heif"];

export function isHeic(file: File): boolean {
  if (HEIC_MIME_TYPES.includes(file.type.toLowerCase())) {
    return true;
  }
  const name = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Converts HEIC/HEIF to JPEG (quality 0.9) in the browser. The converter is
 * loaded on demand so non-HEIC uploads never pay for its bundle.
 * Non-HEIC files are returned untouched. Throws if conversion fails.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeic(file)) {
    return file;
  }

  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) {
    throw new Error("HEIC conversion produced no image");
  }

  const name = file.name.replace(/\.(heic|heif)$/i, ".jpg");
  return new File([blob], name, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
