const EDITABLE_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isEditableImage(mimeType: string): boolean {
  return EDITABLE_IMAGE_MIME.has(mimeType.toLowerCase());
}

export function editedImageName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-editado${name.slice(dot)}` : `${name}-editado`;
}
