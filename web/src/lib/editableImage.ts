const EDITABLE_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Maps a file name to a MIME only to decide editability (not detection). */
export function byExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? "") : "";
}

export function isEditableImage(mimeType: string): boolean {
  return EDITABLE_IMAGE_MIME.has(mimeType.toLowerCase());
}

export function editedImageName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-editado${name.slice(dot)}` : `${name}-editado`;
}
