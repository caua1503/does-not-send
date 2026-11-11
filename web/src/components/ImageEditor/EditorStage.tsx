import { useEffect, useRef, useState } from "react";
import { Check, Crop as CropIcon, Eraser, Minus, Plus, Type } from "lucide-react";
import {
  CROP_ASPECTS,
  centeredCropRect,
  containFit,
  normalizeCropRect,
  rasterize,
  transformCropRect,
} from "../../lib/imageEditor/index.ts";
import type {
  AspectRatio,
  ImageEditorController,
  ImageOp,
  Point,
  Rect,
  Size,
} from "../../lib/imageEditor/index.ts";

type TransformOp = Extract<ImageOp, { type: "rotate" | "rotate-ccw" | "flip-horizontal" | "flip-vertical" }>["type"];

export type EditorTool = "crop" | "rotate" | "draw" | "text";

const COLORS = ["#ffffff", "#000000", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];
const WIDTHS = [6, 14, 28];
const TEXT_SIZE_RATIO = 0.06;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const STRUCTURAL: ReadonlySet<string> = new Set(["crop", "rotate", "rotate-ccw", "flip-horizontal", "flip-vertical"]);

interface EditorStageProps {
  editor: ImageEditorController;
  version: number;
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onCommit: () => void;
}

type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "pan"; x: number; y: number; left: number; top: number }
  | { kind: "crop-move"; start: Point; rect: Rect }
  | { kind: "crop-resize"; corner: Corner; start: Point; rect: Rect }
  | { kind: "stroke"; pts: Point[] };

interface Draft {
  start: Point;
  text: string;
  color: string;
  size: number;
}

const cornerCursor: Record<Corner, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

const corners: Array<{ corner: Corner; className: string }> = [
  { corner: "nw", className: "-top-2 -left-2 cursor-nwse-resize" },
  { corner: "ne", className: "-top-2 -right-2 cursor-nesw-resize" },
  { corner: "sw", className: "-bottom-2 -left-2 cursor-nesw-resize" },
  { corner: "se", className: "-bottom-2 -right-2 cursor-nwse-resize" },
];

function resizeRect(rect: Rect, corner: Corner, p: Point, aspect: AspectRatio, image: Size): Rect {
  const left = corner === "nw" || corner === "sw";
  const top = corner === "nw" || corner === "ne";
  const anchorX = left ? rect.x + rect.width : rect.x;
  const anchorY = top ? rect.y + rect.height : rect.y;
  let width = Math.abs(p.x - anchorX);
  let height = Math.abs(p.y - anchorY);
  if (aspect !== "free" && aspect > 0) {
    if (width / aspect > height) height = width / aspect;
    else width = height * aspect;
  }
  // Shrink until the dragged corner fits inside the image.
  const shrink = Math.min(1, (left ? anchorX : image.width - anchorX) / Math.max(width, 1), (top ? anchorY : image.height - anchorY) / Math.max(height, 1));
  width *= shrink;
  height *= shrink;
  return { x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height };
}

function CropOverlay({ crop, scale }: { crop: Rect; scale: number }) {
  return (
    <div
      data-hit="crop-body"
      aria-label="Área de corte"
      className="absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
      style={{
        left: crop.x * scale,
        top: crop.y * scale,
        width: crop.width * scale,
        height: crop.height * scale,
        cursor: "move",
        backgroundImage:
          "linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.4) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,.4) 66.6%, transparent 66.7%), linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.4) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,.4) 66.6%, transparent 66.7%)",
      }}
    >
      {corners.map(({ corner, className }) => (
        <div
          key={corner}
          data-hit={corner}
          aria-label={`Alça ${corner}`}
          className={`absolute h-8 w-8 touch-none ${className}`}
          style={{ cursor: cornerCursor[corner] }}
        />
      ))}
    </div>
  );
}

export function EditorStage({ editor, version, tool, onToolChange, onCommit }: EditorStageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<{ points: Point[]; color: string; width: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const colorRef = useRef(COLORS[2]!);
  const widthRef = useRef(WIDTHS[1]!);
  const eraseRef = useRef(false);

  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [color, setColor] = useState(COLORS[2]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [erasing, setErasing] = useState(false);
  const [aspectKey, setAspectKey] = useState(Object.keys(CROP_ASPECTS)[0]!);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  colorRef.current = color;
  widthRef.current = width;
  eraseRef.current = erasing;

  const aspect = CROP_ASPECTS[aspectKey] ?? "free";
  const state = editor.getState();
  const drawing = tool === "draw" || tool === "text";

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = containFit({ x: 0, y: 0, width: box.width, height: box.height }, state);
  const scale = fit.scale * zoom;
  const viewW = state.width * scale;
  const viewH = state.height * scale;
  const viewX = Math.max(0, (box.width - viewW) / 2);
  const viewY = Math.max(0, (box.height - viewH) / 2);
  const structuralKey = state.ops.filter((op) => STRUCTURAL.has(op.type)).map((op) => op.type).join();

  // Source + committed ops, repainted whenever the state changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== state.width || canvas.height !== state.height) {
      canvas.width = state.width;
      canvas.height = state.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const baked = rasterize(editor.source(), state, { source: editor.imageSize });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Single blit: "copy" replaces every pixel (a clearRect here loses the
    // pixels right after the draw).
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(baked, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    baked.width = 0;
    baked.height = 0;
  }, [editor, state, version]);

  // New crop frame on entering crop mode or changing aspect.
  useEffect(() => {
    if (tool === "crop") setCrop(centeredCropRect(editor.getState(), aspect));
  }, [tool, aspect, editor]);

  // Structural ops (rotate/flip) re-express the kept crop region, so the frame
  // stays over the same picture content.
  const applied = useRef<{ ops: ImageOp[]; width: number; height: number }>({ ops: [], width: 0, height: 0 });
  useEffect(() => {
    const previous = applied.current;
    applied.current = { ops: state.ops, width: state.width, height: state.height };
    if (tool !== "crop" || previous.ops.length === 0) return;
    const fresh = state.ops.slice(previous.ops.length).filter((op) => STRUCTURAL.has(op.type) && op.type !== "crop");
    if (fresh.length === 0) return;
    const from = { width: previous.width, height: previous.height };
    setCrop((c) => {
      if (!c) return c;
      let next: Rect = { ...c };
      let size = from;
      for (const op of fresh) {
        const type = op.type as TransformOp;
        if (type !== "rotate" && type !== "rotate-ccw" && type !== "flip-horizontal" && type !== "flip-vertical") continue;
        next = transformCropRect(next, type, size);
        size = type === "rotate" || type === "rotate-ccw" ? { width: size.height, height: size.width } : size;
      }
      return normalizeCropRect(next, state, aspect) ?? centeredCropRect(state, aspect);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey]);

  const activeCrop = tool === "crop" ? crop : null;
  useEffect(() => {
    if (tool === "crop") applied.current = { ops: state.ops, width: state.width, height: state.height };
  });

  const clientToImage = (client: Point): Point => {
    const rect = contentRef.current!.getBoundingClientRect();
    return {
      x: ((client.x - rect.left) / rect.width) * state.width,
      y: ((client.y - rect.top) / rect.height) * state.height,
    };
  };

  const clientToView = (client: Point): Point => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: client.x - rect.left - viewX, y: client.y - rect.top - viewY };
  };

  const zoomAround = (at: Point, target: number) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
    const scroller = wrapRef.current;
    if (!scroller || z === zoom) return;
    const ratio = z / zoom;
    const nextX = Math.max(0, (box.width - state.width * fit.scale * z) / 2);
    const nextY = Math.max(0, (box.height - state.height * fit.scale * z) / 2);
    scroller.scrollLeft = (scroller.scrollLeft + at.x - viewX) * ratio + nextX - at.x;
    scroller.scrollTop = (scroller.scrollTop + at.y - viewY) * ratio + nextY - at.y;
    setZoom(z);
  };

  const hitTarget = (e: React.PointerEvent) =>
    ((e.target as HTMLElement).closest<HTMLElement>("[data-hit]")?.dataset.hit ?? null) as
      | "crop-body"
      | Corner
      | null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button > 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = hitTarget(e);
    const p = clientToImage({ x: e.clientX, y: e.clientY });

    if (crop && tool !== "draw" && tool !== "text") {
      if (target === "crop-body") {
        dragRef.current = { kind: "crop-move", start: p, rect: crop };
        return;
      }
      if (target) {
        dragRef.current = { kind: "crop-resize", corner: target, start: p, rect: crop };
        return;
      }
    }

    const inside = target === null && p.x >= 0 && p.y >= 0 && p.x <= state.width && p.y <= state.height;

    if (tool === "text" && inside) {
      setDraft({
        start: p,
        text: "",
        color: colorRef.current,
        size: Math.max(10, Math.round(Math.min(state.width, state.height) * TEXT_SIZE_RATIO)),
      });
      return;
    }

    if (tool === "draw" && inside) {
      dragRef.current = { kind: "stroke", pts: [p] };
      setPreview({ points: [p], color: colorRef.current, width: widthRef.current / scale });
      return;
    }

    dragRef.current = {
      kind: "pan",
      x: e.clientX,
      y: e.clientY,
      left: e.currentTarget.scrollLeft,
      top: e.currentTarget.scrollTop,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    if (d.kind === "pan") {
      e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
      e.currentTarget.scrollTop = d.top - (e.clientY - d.y);
      return;
    }
    const p = clientToImage({ x: e.clientX, y: e.clientY });
    if (d.kind === "crop-move") {
      setCrop({
        ...d.rect,
        x: Math.min(Math.max(0, d.rect.x + p.x - d.start.x), state.width - d.rect.width),
        y: Math.min(Math.max(0, d.rect.y + p.y - d.start.y), state.height - d.rect.height),
      });
    } else if (d.kind === "crop-resize") {
      setCrop(resizeRect(d.rect, d.corner, p, aspect, state));
    } else {
      const last = d.pts[d.pts.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1 / scale) return;
      d.pts.push(p);
      setPreview({ points: [...d.pts], color: colorRef.current, width: widthRef.current / scale });
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind !== "stroke") return;
    setPreview(null);
    editor.apply({
      type: "stroke",
      tool: eraseRef.current ? "erase" : "draw",
      color: eraseRef.current ? "#000000" : colorRef.current,
      width: widthRef.current / scale,
      points: d.pts,
    });
    onCommit();
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setPreview(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (drawing) return;
    e.preventDefault();
    zoomAround(clientToView({ x: e.clientX, y: e.clientY }), zoom * Math.exp(-e.deltaY * 0.0015));
  };

  const applyCrop = () => {
    if (crop) {
      const rect = normalizeCropRect(crop, state, aspect);
      if (rect) {
        editor.apply({ type: "crop", rect }, { aspect });
        onCommit();
      }
    }
    setCrop(null);
    onToolChange("crop");
  };

  const commitDraft = () => {
    if (!draft) return;
    const text = draft.text.trim();
    setDraft(null);
    if (!text) return;
    editor.apply({ type: "text", text, x: draft.start.x, y: draft.start.y + draft.size, color: draft.color, size: draft.size });
    onCommit();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-auto touch-none select-none"
        style={{ cursor: drawing ? "crosshair" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onContextMenu={tool === "draw" ? (e) => e.preventDefault() : undefined}
      >
        <div className="relative mx-auto" style={{ width: viewW, height: viewH, marginTop: viewY }}>
          <div ref={contentRef} className="absolute inset-0">
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: zoom > 2 ? "pixelated" : "auto" }} aria-label="Prévia da imagem" />
            {preview && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${state.width} ${state.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={preview.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={preview.color}
                  strokeWidth={preview.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {activeCrop && <CropOverlay crop={activeCrop} scale={scale} />}
          </div>
        </div>
      </div>

      {tool === "crop" && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-2 py-2">
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Proporção">
            {Object.keys(CROP_ASPECTS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setAspectKey(key)}
                aria-pressed={aspectKey === key}
                className={`min-h-[36px] shrink-0 rounded-full px-3 text-xs ${aspectKey === key ? "bg-white text-black" : "bg-white/10 text-white"}`}
              >
                {key}
              </button>
            ))}
          </div>
          <button type="button" onClick={applyCrop} disabled={!crop} aria-label="Aplicar corte" className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-40">
            <CropIcon size={16} aria-hidden="true" />
            Aplicar
          </button>
        </div>
      )}

      {tool === "draw" && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-3 py-2">
          <div className="flex gap-1.5" role="group" aria-label="Cor">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={erasing}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
                aria-pressed={!erasing && color === c}
                className={`h-7 w-7 rounded-full border disabled:opacity-40 ${!erasing && color === c ? "ring-2 ring-white" : "border-white/30"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Espessura">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                aria-label={`Espessura ${w}`}
                aria-pressed={width === w}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${width === w ? "bg-white/20" : ""}`}
              >
                <span className="rounded-full bg-white" style={{ width: w / 2, height: w / 2 }} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setErasing((v) => !v)}
            aria-pressed={erasing}
            aria-label="Borracha"
            className={`flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs ${erasing ? "bg-white text-black" : "bg-white/10 text-white"}`}
          >
            <Eraser size={14} aria-hidden="true" />
            Borracha
          </button>
        </div>
      )}

      {tool === "text" && (
        <div className="flex items-center justify-center gap-1.5 px-3 py-2" role="group" aria-label="Cor do texto">
          <Type size={14} className="text-white/60" aria-hidden="true" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              className={`h-7 w-7 rounded-full border ${color === c ? "ring-2 ring-white" : "border-white/30"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-1 pb-2 text-xs text-white/70">
        <button type="button" onClick={() => zoomAround({ x: box.width / 2, y: box.height / 2 }, zoom / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Diminuir zoom" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30">
          <Minus size={14} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => zoomAround({ x: box.width / 2, y: box.height / 2 }, 1)} aria-label="Ajustar à tela" className="min-w-12 tabular">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomAround({ x: box.width / 2, y: box.height / 2 }, zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Aumentar zoom" className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30">
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {draft && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <form
            className="w-full max-w-md rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3 text-[var(--color-text)]"
            role="dialog"
            aria-label="Editar texto"
            onSubmit={(e) => {
              e.preventDefault();
              commitDraft();
            }}
          >
            <input
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="Digite o texto"
              className="w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDraft(null);
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={draft.color === c}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className={`h-6 w-6 rounded-full ${draft.color === c ? "ring-2 ring-[var(--color-accent)]" : "border border-[var(--color-border)]"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button type="submit" aria-label="Aplicar texto" className="flex min-h-[36px] items-center gap-1 rounded-[var(--radius-btn)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white">
                <Check size={16} aria-hidden="true" />
                OK
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
