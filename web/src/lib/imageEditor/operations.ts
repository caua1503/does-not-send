/**
 * Operation application. Pure: same ops + same initial size → same state.
 * Zoom-independent because everything stays in image pixels.
 */

import { normalizeCropRect, rectsIntersect, simplifyPoints, strokeBounds } from "./geometry.ts";
import { mapPoint, structuralStep, type StructuralOp } from "./structuralTransform.ts";
import type { AspectRatio, EditorState, ImageOp, StrokeOp, TextOp } from "./types.ts";

function applyStructural(state: EditorState, op: StructuralOp): EditorState {
  const { matrix, size } = structuralStep(op, state);
  const annotations = state.ops.map((existing): ImageOp => {
    if (existing.type === "stroke") {
      const moved = { ...existing, points: existing.points.map((point) => mapPoint(matrix, point)) };
      if (op.type === "crop" && !rectsIntersect(strokeBounds(moved), { x: 0, y: 0, ...size })) {
        return { ...moved, points: [] };
      }
      return moved;
    }
    if (existing.type === "text") {
      const rotation = existing.rotation;
      const nextRotation =
        op.type === "rotate" ? rotation + 90 :
        op.type === "rotate-ccw" ? rotation - 90 :
        op.type === "crop" ? rotation : -rotation;
      return { ...existing, ...mapPoint(matrix, existing), rotation: ((nextRotation + 360) % 360) as TextOp["rotation"] };
    }
    return existing;
  });
  return { width: size.width, height: size.height, ops: [op, ...annotations] };
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
      return applyStructural(state, { type: "crop", rect });
    }

    case "rotate":
    case "rotate-ccw":
    case "flip-horizontal":
    case "flip-vertical":
      return applyStructural(state, op);

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
