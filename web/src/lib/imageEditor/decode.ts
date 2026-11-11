/**
 * Decoding for the editor. Uses createImageBitmap (honours EXIF orientation,
 * fast on phones) and falls back to an <img>.createObjectURL for browsers or
 * formats without bitmap support. Every object URL is revoked before return.
 */

import type { DecodedImage } from "./controller.ts";

async function decodeWithBitmap(blob: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, size: { width: bitmap.width, height: bitmap.height } };
  } catch {
    return null;
  }
}

function decodeWithImg(blob: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Image has no pixels"));
        return;
      }
      resolve({ source: img, size: { width: img.naturalWidth, height: img.naturalHeight } });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  const fromBitmap = await decodeWithBitmap(blob);
  if (fromBitmap) return fromBitmap;
  return decodeWithImg(blob);
}
