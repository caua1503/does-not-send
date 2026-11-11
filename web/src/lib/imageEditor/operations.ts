/**
 * Operation application. Pure: same ops + same initial size → same state.
 * Zoom-independent because everything stays in image pixels.
 */

import {
  normalizeCropRect,
  rectsIntersect,
  rotateSize,
  simplifyPoints,
  strokeBounds,
  transformCropRect,
} from "./geometry.ts";
import type { AspectRatio, CropOp, EditorState, FlipOp, ImageOp, Rect, RotationOp, StrokeOp, TextOp } from "./types.ts";

function transformStroke(stroke: StrokeOp, rotation: RotationOp["type"], from: { width: number; height: number }): StrokeOp {
  return {
    ...stroke,
    points: stroke.points.map((p) =>
      rotation === "rotate"
        ? { x: from.height - p.y, y: p.x }
        : { x: p.y, y: from.width - p.x },
    ),
  };
}

function transformFlip(op: ImageOp, flip: FlipOp["type"], size: { width: number; height: number }): ImageOp {
  switch (op.type) {
    case "stroke":
      return {
        ...op,
        points: op.points.map((p) =>
          flip === "flip-horizontal" ? { x: size.width - p.x, y: p.y } : { x: p.x, y: size.height - p.y },
        ),
      };
    case "text":
      return flip === "flip-horizontal"
        ? { ...op, x: size.width - op.x }
        : { ...op, y: size.height - op.y };
    case "crop":
      return { ...op, rect: transformCropRect(op.rect, flip, size) };
    default:
      return op;
  }
}

/** Crop clips content already drawn onto the cropped coordinate space. */
function transformOpForCrop(op: ImageOp, rect: Rect): ImageOp {
  switch (op.type) {
    case "crop": {
      const r = op.rect;
      return { ...op, rect: { x: r.x - rect.x, y: r.y - rect.y, width: r.width, height: r.height } };
    }
    case "stroke": {
      const moved: StrokeOp = { ...op, points: op.points.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })) };
      const visible = rectsIntersect(strokeBounds(moved), { x: 0, y: 0, width: rect.width, height: rect.height });
      return visible ? moved : { ...moved, points: [] };
    }
    case "text":
      return { ...op, x: op.x - rect.x, y: op.y - rect.y };
    default:
      return op;
  }
}

export interface ApplyOptions {
  /** Aspect used to normalize crop rects. Default "free". */
  aspect?: AspectRatio;
}

/**
 * Apply one op to a state. Returns a NEW state; never mutates input.
 * Throws on an invalid op (empty crop, empty stroke, blank text).
 */
export function applyOp(state: EditorState, op: ImageOp, options: ApplyOptions = {}): EditorState {
  switch (op.type) {
    case "crop": {
      const rect = normalizeCropRect(op.rect, state, options.aspect ?? "free");
      if (!rect) throw new Error("crop rect is empty");
      const crop: CropOp = { type: "crop", rect };
      const ops: ImageOp[] = [crop, ...state.ops.map((o) => transformOpForCrop(o, rect))];
      return { width: rect.width, height: rect.height, ops };
    }

    case "rotate":
    case "rotate-ccw": {
      const next = rotateSize(state, op.type === "rotate" ? 1 : -1);
      const ops = state.ops.map((o) => (o.type === "stroke" ? transformStroke(o, op.type, state) : o));
      return { width: next.width, height: next.height, ops };
    }

    case "flip-horizontal":
    case "flip-vertical": {
      const ops = state.ops.map((o) => transformFlip(o, op.type, state));
      return { width: state.width, height: state.height, ops };
    }

    case "stroke": {
      const points = simplifyPoints(op.points);
      if (points.length === 0) throw new Error("stroke has no points");
      if (!(op.width > 0)) throw new Error("stroke width must be positive");
      const stroke: StrokeOp = { ...op, points };
      return { ...state, ops: [...state.ops, stroke] };
    }

    case "text": {
      const text = op.text.trim();
      if (!text) throw new Error("text is empty");
      if (!(op.size > 0)) throw new Error("text size must be positive");
      const t: TextOp = { ...op, text };
      return { ...state, ops: [...state.ops, t] };
    }
  }
}
