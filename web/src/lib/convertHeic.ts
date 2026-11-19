import { runImageWorker } from "./imageWorker.ts";

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

  const worker = new Worker(new URL("./convertHeic.worker.ts", import.meta.url), { type: "module" });
  const blob = await runImageWorker(worker, file, 60_000);

  const name = /\.(heic|heif)$/i.test(file.name)
    ? file.name.replace(/\.(heic|heif)$/i, ".jpg")
    : `${file.name}.jpg`;
  return new File([blob], name, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
