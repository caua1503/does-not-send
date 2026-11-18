/**
 * Pure geometry for the image editor: crop/rotate/flip math and
 * pointer→image-space mapping. No canvas, no DOM.
 */

import { mapPoint, structuralStep, type StructuralOp } from "./structuralTransform.ts";
import type { AspectRatio, Point, Rect, Size, StrokeOp } from "./types.ts";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Rotate size by quarter turns. `turns` is the signed number of 90° CW turns.
 */
export function rotateSize(size: Size, turns: number): Size {
  const t = ((turns % 4) + 4) % 4;
  return t % 2 === 0 ? { width: size.width, height: size.height } : { width: size.height, height: size.width };
}

/**
 * Normalize a user crop rect: clamp to the image, integer-snap, drop empty.
 * `aspect` (w/h) forces the resulting rect to that ratio, shrinking inside the
 * clamped rect. Returns null when nothing usable remains.
 */
export function normalizeCropRect(rect: Rect, image: Size, aspect: AspectRatio = "free"): Rect | null {
  const left = clamp(Math.round(rect.x), 0, image.width);
  const top = clamp(Math.round(rect.y), 0, image.height);
  const right = clamp(Math.round(rect.x + rect.width), 0, image.width);
  const bottom = clamp(Math.round(rect.y + rect.height), 0, image.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;

  if (aspect === "free" || !(aspect > 0)) {
    return { x: left, y: top, width, height };
  }

  let w = width;
  let h = Math.round(w / aspect);
  if (h > height) {
    h = height;
    w = Math.round(h * aspect);
  }
  w = Math.max(1, Math.min(w, width));
  h = Math.max(1, Math.min(h, height));
  const x = clamp(left + Math.round((width - w) / 2), 0, image.width - w);
  const y = clamp(top + Math.round((height - h) / 2), 0, image.height - h);
  return { x, y, width: w, height: h };
}

/**
 * Crop rect for a centered rect of the given aspect, as large as fits.
 */
export function centeredCropRect(image: Size, aspect: AspectRatio): Rect {
  if (aspect === "free") {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  const imageAspect = image.width / image.height;
  const w = imageAspect > aspect ? Math.round(image.height * aspect) : image.width;
  const h = imageAspect > aspect ? image.height : Math.round(image.width / aspect);
  return { x: Math.round((image.width - w) / 2), y: Math.round((image.height - h) / 2), width: w, height: h };
}

/** Re-express the same picture region after a rotate or flip. */
export function transformCropRect(rect: Rect, op: Exclude<StructuralOp["type"], "crop">, from: Size): Rect {
  const { matrix } = structuralStep({ type: op }, from);
  const first = mapPoint(matrix, rect);
  const last = mapPoint(matrix, { x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width: Math.abs(first.x - last.x),
    height: Math.abs(first.y - last.y),
  };
}

/**
 * Pointer → image pixel coords. `view` is the image rect on screen
 * (object-fit: contain inside the canvas), measured in CSS pixels.
 */
export function pointerToImage(client: Point, view: Rect, image: Size): Point {
  const { scale, offsetX, offsetY } = containFit(view, image);
  return {
    x: (client.x - offsetX) / scale,
    y: (client.y - offsetY) / scale,
  };
}

/** Image → screen point (inverse of pointerToImage). */
export function imageToPointer(p: Point, view: Rect, image: Size): Point {
  const { scale, offsetX, offsetY } = containFit(view, image);
  return { x: offsetX + p.x * scale, y: offsetY + p.y * scale };
}

/** object-fit: contain mapping from view rect to image. */
export function containFit(view: Rect, image: Size): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.max(1e-9, Math.min(view.width / image.width, view.height / image.height));
  return {
    scale,
    offsetX: view.x + (view.width - image.width * scale) / 2,
    offsetY: view.y + (view.height - image.height * scale) / 2,
  };
}

/** Trim points that coincide; keeps the stroke minimal. */
export function simplifyPoints(points: Point[], epsilon = 0.5): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= epsilon) out.push(p);
  }
  return out;
}

/** Bounding box of a stroke, padded by half the stroke width. */
export function strokeBounds(stroke: StrokeOp): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  const pad = stroke.width / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
