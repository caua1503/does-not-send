/**
 * Canvas rasterization of an editor state. The only DOM-dependent part
 * besides `controller.ts`. Edits are destructive on export: the canvas is
 * drawn once at the received resolution.
 */

import type { EditorState, ExportOptions, ImageOp, Size, StrokeOp, TextOp } from "./types.ts";

type Ctx2D = CanvasRenderingContext2D;

/** Font family used for text ops; must match what the UI previews. */
export const TEXT_FONT_FAMILY = "Inter, system-ui, sans-serif";

function lineWidthFor(stroke: StrokeOp): number {
  return Math.max(1, stroke.width);
}

function drawStroke(ctx: Ctx2D, stroke: StrokeOp): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "erase" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lineWidthFor(stroke);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0]!.x, pts[0]!.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawText(ctx: Ctx2D, text: TextOp): void {
  ctx.save();
  ctx.fillStyle = text.color;
  ctx.font = `${text.size}px ${TEXT_FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text.text, text.x, text.y);
  ctx.restore();
}

/** Replay drawn ops over existing pixels (no clear). */
function drawOps(ctx: Ctx2D, state: EditorState): void {
  for (const op of state.ops) drawOp(ctx, op);
}

export function drawOp(ctx: Ctx2D, op: ImageOp): void {
  switch (op.type) {
    case "stroke":
      drawStroke(ctx, op);
      return;
    case "text":
      drawText(ctx, op);
      return;
    case "crop":
    case "rotate":
    case "rotate-ccw":
    case "flip-horizontal":
    case "flip-vertical":
      // Already baked into coordinates by operations.ts; nothing to draw.
      return;
  }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getContext2D(canvas: HTMLCanvasElement): Ctx2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}

export interface RasterizeOptions {
  /** Size of the decoded source, pre-crop/rotate/flip. Defaults to state size. */
  source?: Size;
}

/**
 * Rasterize the source + ops at the state's resolution. Structural ops
 * (crop/rotate/flip) are baked into the source transform, so the decoded
 * source may be any size; drawn ops are then replayed at scale 1.
 * The crop transform only composes with rotations because crops always land
 * at the head of the op list (see applyOp).
 */
export function rasterize(source: CanvasImageSource, state: EditorState, options: RasterizeOptions = {}): HTMLCanvasElement {
  const canvas = createCanvas(state.width, state.height);
  const ctx = getContext2D(canvas);
  const sourceSize = options.source ?? state;
  ctx.save();
  for (const op of state.ops) {
    switch (op.type) {
      case "crop":
        ctx.translate(-op.rect.x, -op.rect.y);
        break;
      case "rotate":
        ctx.translate(sourceSize.height, 0);
        ctx.rotate(Math.PI / 2);
        break;
      case "rotate-ccw":
        ctx.translate(0, sourceSize.width);
        ctx.rotate(-Math.PI / 2);
        break;
      case "flip-horizontal":
        ctx.translate(sourceSize.width, 0);
        ctx.scale(-1, 1);
        break;
      case "flip-vertical":
        ctx.translate(0, sourceSize.height);
        ctx.scale(1, -1);
        break;
      default:
        break;
    }
  }
  ctx.drawImage(source, 0, 0, sourceSize.width, sourceSize.height);
  ctx.restore();
  drawOps(ctx, state);
  return canvas;
}

/**
 * Encode a canvas to a Blob. Falls back to PNG when the canvas cannot encode
 * the requested MIME (e.g. unsupported format on Safari).
 */
export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          if (mimeType !== "image/png") {
            canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("canvas.toBlob returned null"))), "image/png");
            return;
          }
          reject(new Error("canvas.toBlob returned null"));
        },
        mimeType,
        quality,
      );
    } catch (err) {
      reject(err);
    }
  });
}

export const DEFAULT_QUALITY = 0.92;

/**
 * Export the state as a File in the original MIME at the received resolution.
 * Quality only applies to JPEG/WebP. Ops are rasterized into the file: the
 * result has no transparency handling (JPEG flattens to black, by design).
 */
export async function exportImage(
  source: CanvasImageSource,
  state: EditorState,
  options: ExportOptions,
  sourceSize?: Size,
): Promise<File> {
  const mime = options.mimeType || "image/png";
  const canvas = rasterize(source, state, { source: sourceSize });
  try {
    const blob = await canvasToBlob(canvas, mime, options.quality ?? DEFAULT_QUALITY);
    return new File([blob], options.fileName, {
      type: blob.type || mime,
      lastModified: Date.now(),
    });
  } finally {
    // Free the backing store on phones as soon as we are done.
    canvas.width = 0;
    canvas.height = 0;
  }
}
