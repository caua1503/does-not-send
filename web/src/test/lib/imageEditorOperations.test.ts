import { describe, it, expect } from "vitest";
import { applyOp } from "../../lib/imageEditor/operations.ts";
import {
  centeredCropRect,
  normalizeCropRect,
  pointerToImage,
  imageToPointer,
  rotateSize,
  transformCropRect,
} from "../../lib/imageEditor/geometry.ts";
import { createImageEditor } from "../../lib/imageEditor/controller.ts";
import type { EditorState, Rect, Size } from "../../lib/imageEditor/types.ts";

const base: EditorState = { width: 100, height: 60, ops: [] };

function stroke(points: Array<[number, number]>) {
  return { type: "stroke" as const, tool: "draw" as const, color: "#f00", width: 4, points: points.map(([x, y]) => ({ x, y })) };
}

describe("imageEditor geometry", () => {
  it("rotaciona 90° trocando largura e altura", () => {
    expect(rotateSize({ width: 100, height: 60 }, 1)).toEqual({ width: 60, height: 100 });
    expect(rotateSize({ width: 100, height: 60 }, -1)).toEqual({ width: 60, height: 100 });
    expect(rotateSize({ width: 100, height: 60 }, 4)).toEqual({ width: 100, height: 60 });
  });

  it("crop livre é clampado à imagem e arredondado", () => {
    expect(normalizeCropRect({ x: -5, y: 10, width: 200, height: 30 }, base)).toEqual({ x: 0, y: 10, width: 100, height: 30 });
    expect(normalizeCropRect({ x: 10, y: 10, width: 0, height: 30 }, base)).toBeNull();
  });

  it("crop com proporção fixa mantém o ratio", () => {
    const r = normalizeCropRect({ x: 0, y: 0, width: 100, height: 60 }, base, 1)!;
    expect(r.width).toBe(r.height);
    const wide = normalizeCropRect({ x: 0, y: 0, width: 100, height: 60 }, base, 16 / 9)!;
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
  });

  it("crop centrado cobre o máximo possível", () => {
    expect(centeredCropRect({ width: 100, height: 60 }, 1)).toEqual({ x: 20, y: 0, width: 60, height: 60 });
    expect(centeredCropRect({ width: 100, height: 60 }, "free")).toEqual({ x: 0, y: 0, width: 100, height: 60 });
  });

  it("crop transformado por giro/espelho continua na mesma região", () => {
    const r = { x: 10, y: 5, width: 20, height: 10 };
    expect(transformCropRect(r, "rotate", base)).toEqual({ x: 60 - 5, y: 10, width: 10, height: 20 });
    expect(transformCropRect(r, "flip-horizontal", base)).toEqual({ x: 100 - 30, y: 5, width: 20, height: 10 });
    expect(transformCropRect(r, "flip-vertical", base)).toEqual({ x: 10, y: 60 - 15, width: 20, height: 10 });
  });

  it("pointerToImage e imageToPointer são inversos com letterbox", () => {
    const image = { width: 200, height: 100 } as Size;
    // contain: escala 0.5 → imagem 100x50, centrada em y=45 (letterbox 20–45 e 95–120)
    const view = { x: 10, y: 20, width: 100, height: 100 } as Rect;
    const p = pointerToImage({ x: 60, y: 45 }, view, image);
    expect(p).toEqual({ x: 100, y: 0 });
    expect(imageToPointer(p, view, image)).toEqual({ x: 60, y: 45 });
    expect(pointerToImage({ x: 60, y: 95 }, view, image)).toEqual({ x: 100, y: 100 });
  });
});

describe("imageEditor operations", () => {
  it("crop reduz o tamanho e desloca o conteúdo desenhado antes", () => {
    const drawn = applyOp(base, stroke([[10, 10], [90, 50]]));
    const cropped = applyOp(drawn, { type: "crop", rect: { x: 10, y: 10, width: 50, height: 40 } });
    expect(cropped.width).toBe(50);
    expect(cropped.height).toBe(40);
    const s = cropped.ops.find((o) => o.type === "stroke");
    expect(s && s.type === "stroke" ? s.points[0] : null).toEqual({ x: 0, y: 0 });
  });

  it("giro 90° CW remapeia pontos do traço", () => {
    const drawn = applyOp(base, stroke([[10, 0], [10, 60]]));
    const rotated = applyOp(drawn, { type: "rotate" });
    expect(rotated.width).toBe(60);
    expect(rotated.height).toBe(100);
    const s = rotated.ops[0]!;
    expect(s.type).toBe("stroke");
    if (s.type === "stroke") expect(s.points).toEqual([{ x: 60, y: 10 }, { x: 0, y: 10 }]);
  });

  it("espelho horizontal inverte x do traço e do texto", () => {
    const state = applyOp(applyOp(base, stroke([[10, 20]])), {
      type: "text",
      text: "oi",
      x: 10,
      y: 20,
      color: "#000",
      size: 10,
    });
    const flipped = applyOp(state, { type: "flip-horizontal" });
    const s = flipped.ops[0]!;
    const t = flipped.ops[1]!;
    if (s.type === "stroke") expect(s.points[0]).toEqual({ x: 90, y: 20 });
    if (t.type === "text") expect(t.x).toBe(90);
    expect(flipped.width).toBe(state.width);
  });

  it("traço repetido é simplificado e adicionado no fim", () => {
    const s = applyOp(base, stroke([[10, 10], [10, 10.1], [30, 30]]));
    expect(s.ops).toHaveLength(1);
    const op = s.ops[0]!;
    if (op.type === "stroke") expect(op.points).toHaveLength(2);
  });

  it("rejeita crop vazio, traço vazio e texto em branco", () => {
    expect(() => applyOp(base, { type: "crop", rect: { x: 0, y: 0, width: 0, height: 10 } })).toThrow();
    expect(() => applyOp(base, stroke([]))).toThrow();
    expect(() => applyOp(base, { type: "text", text: "   ", x: 0, y: 0, color: "#000", size: 10 })).toThrow();
  });

  it("não muta o estado de entrada", () => {
    const snapshot = JSON.stringify(base);
    applyOp(base, { type: "rotate" });
    applyOp(base, stroke([[1, 1], [2, 2]]));
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("imageEditor controller", () => {
  const fakeSource = () => ({ close: () => {}, width: 1, height: 1 }) as unknown as ImageBitmap;

  it("guarda MIME/nome originais, desfaz tudo e libera a fonte ao fechar", () => {
    let released = false;
    const source = { close: () => { released = true; } } as unknown as ImageBitmap;
    const file = new File([new Uint8Array(4)], "foto.webp", { type: "image/webp" });
    const editor = createImageEditor(file, { source, size: { width: 10, height: 20 } });
    editor.apply({ type: "rotate" });
    expect(editor.getState()).toMatchObject({ width: 20, height: 10 });
    expect(editor.isPristine()).toBe(false);
    editor.undoAll();
    expect(editor.isPristine()).toBe(true);
    expect(editor.mimeType).toBe("image/webp");
    expect(editor.fileName).toBe("foto.webp");

    editor.close();
    expect(released).toBe(true);
    expect(editor.closed).toBe(true);
    expect(() => editor.apply({ type: "rotate" })).toThrow(/closed/);
    editor.close(); // idempotente
  });

  it("recusa arquivo que não é imagem", () => {
    const file = new File([new Uint8Array(4)], "a.txt", { type: "text/plain" });
    expect(() => createImageEditor(file, { source: fakeSource(), size: { width: 1, height: 1 } })).toThrow();
  });

  it("recusa imagem sem pixels", () => {
    const file = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    expect(() => createImageEditor(file, { source: fakeSource(), size: { width: 0, height: 0 } })).toThrow();
  });
});
