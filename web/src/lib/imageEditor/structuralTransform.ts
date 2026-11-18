import type { CropOp, FlipOp, ImageOp, Point, RotationOp, Size } from "./types.ts";

export type StructuralOp = CropOp | FlipOp | RotationOp;
type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export function structuralStep(op: StructuralOp, size: Size): { matrix: Matrix; size: Size } {
  switch (op.type) {
    case "crop":
      return { matrix: [1, 0, 0, 1, -op.rect.x, -op.rect.y], size: { width: op.rect.width, height: op.rect.height } };
    case "rotate":
      return { matrix: [0, 1, -1, 0, size.height, 0], size: { width: size.height, height: size.width } };
    case "rotate-ccw":
      return { matrix: [0, -1, 1, 0, 0, size.width], size: { width: size.height, height: size.width } };
    case "flip-horizontal":
      return { matrix: [-1, 0, 0, 1, size.width, 0], size };
    case "flip-vertical":
      return { matrix: [1, 0, 0, -1, 0, size.height], size };
  }
}

export function mapPoint([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function structuralTransform(ops: readonly ImageOp[], sourceSize: Size): { matrix: Matrix; size: Size } {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  let size = sourceSize;
  // The inner edit sees the original image. Each outer edit sees its output.
  for (const op of [...ops].reverse()) {
    if (op.type === "stroke" || op.type === "text") continue;
    const step = structuralStep(op, size);
    const [a, b, c, d, e, f] = step.matrix;
    const [g, h, i, j, k, l] = matrix;
    matrix = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
    size = step.size;
  }
  return { matrix, size };
}
