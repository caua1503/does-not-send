/**
 * Session lifecycle: holds the decoded image + history in memory for one
 * editing session and releases both on close. No React; the UI subscribes.
 */

import { createHistory, currentState, isPristine, pushState, redo, undo, undoAll } from "./history.ts";
import { applyOp, type ApplyOptions } from "./operations.ts";
import { exportImage } from "./render.ts";
import type { EditorState, ExportOptions, History, ImageOp, Size } from "./types.ts";

export interface DecodedImage {
  /** ImageBitmap or an unattached canvas. Freed by `close()`. */
  source: CanvasImageSource & { close?: () => void };
  size: Size;
}

export interface ImageEditorController {
  readonly imageSize: Size;
  /** Original MIME of the input; export reuses it. */
  readonly mimeType: string;
  readonly fileName: string;
  getHistory(): History;
  getState(): EditorState;
  /** Decoded, EXIF-oriented original (read-only; freed by `close()`). */
  source(): CanvasImageSource;
  apply(op: ImageOp, options?: ApplyOptions): void;
  undo(): void;
  redo(): void;
  undoAll(): void;
  /** True when back at the original (nothing to export differently). */
  isPristine(): boolean;
  export(options?: Partial<ExportOptions>): Promise<File>;
  /** Release canvas/bitmap. Idempotent; any later call throws. */
  close(): void;
  readonly closed: boolean;
}

export function createImageEditor(input: File, decoded: DecodedImage): ImageEditorController {
  if (!(decoded.size.width > 0) || !(decoded.size.height > 0)) {
    throw new Error("Image has no pixels");
  }
  if (!input.type.startsWith("image/")) {
    throw new Error(`Not an image: ${input.type || "unknown"}`);
  }

  let history = createHistory(decoded.size.width, decoded.size.height);
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error("Image editor is closed");
  }

  const controller: ImageEditorController = {
    imageSize: { ...decoded.size },
    mimeType: input.type,
    fileName: input.name,

    get closed() {
      return closed;
    },

    getHistory: () => history,

    getState: () => currentState(history),

    source() {
      assertOpen();
      return decoded.source;
    },

    apply(op, options) {
      assertOpen();
      history = pushState(history, applyOp(currentState(history), op, options));
    },

    undo() {
      assertOpen();
      history = undo(history);
    },

    redo() {
      assertOpen();
      history = redo(history);
    },

    undoAll() {
      assertOpen();
      history = undoAll(history);
    },

    isPristine: () => isPristine(history),

    async export(options) {
      assertOpen();
      return exportImage(decoded.source, currentState(history), {
        fileName: options?.fileName ?? input.name,
        mimeType: options?.mimeType ?? input.type,
        quality: options?.quality,
      }, decoded.size);
    },

    close() {
      if (closed) return;
      closed = true;
      decoded.source.close?.();
      history = createHistory(1, 1);
    },
  };

  return controller;
}
