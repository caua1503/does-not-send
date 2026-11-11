/**
 * Image editor domain types. Pure: no DOM, no React.
 * All coordinates are in the CURRENT image space (post-crop/rotate/flip),
 * never in screen/canvas space. Integer pixels.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** width/height aspect ratio fixed by the UI; "free" = any crop size. */
export type AspectRatio = number | "free";

export const CROP_ASPECTS: Readonly<Record<string, AspectRatio>> = {
  livre: "free",
  "1:1": 1,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

export interface CropOp {
  type: "crop";
  rect: Rect;
}

export type RotationOp = { type: "rotate" } | { type: "rotate-ccw" };

export type FlipOp = { type: "flip-horizontal" } | { type: "flip-vertical" };

export type StrokeTool = "draw" | "erase";

/** Polyline drawn at creation time: points are already in image space. */
export interface StrokeOp {
  type: "stroke";
  tool: StrokeTool;
  color: string;
  /** Width in image pixels, not screen pixels. */
  width: number;
  points: Point[];
}

export interface TextOp {
  type: "text";
  text: string;
  /** Baseline origin in image pixels (left, text baseline). */
  x: number;
  y: number;
  color: string;
  /** Font size in image pixels. */
  size: number;
}

export type ImageOp = CropOp | RotationOp | FlipOp | StrokeOp | TextOp;

export type OpType = ImageOp["type"];

/** Immutable editor state: applying an op returns a new state. */
export interface EditorState {
  /** Computed from ops; ops were already clipped/transformed to it. */
  width: number;
  height: number;
  ops: ImageOp[];
}

export interface History {
  initial: EditorState;
  /** Applied states. states[0] === initial, always. */
  states: EditorState[];
  /** -1 = nothing to redo (states.length - 1 is the last index). */
  index: number;
}

export interface ExportOptions {
  fileName: string;
  /** Used verbatim; falls back to "image/png" if canvas cannot encode it. */
  mimeType: string;
  quality?: number;
}
