import { describe, it, expect } from "vitest";
import {
  canRedo,
  canUndo,
  createHistory,
  currentState,
  isPristine,
  pushState,
  redo,
  undo,
  undoAll,
} from "../../lib/imageEditor/history.ts";
import { applyOp } from "../../lib/imageEditor/operations.ts";

const text = (t: string) => ({ type: "text" as const, text: t, x: 1, y: 1, color: "#000", size: 12 });

function historyWith(...labels: string[]) {
  let h = createHistory(100, 80);
  for (const label of labels) h = pushState(h, applyOp(currentState(h), text(label)));
  return h;
}

describe("imageEditor history", () => {
  it("começa no original sem desfazer/refazer", () => {
    const h = createHistory(100, 80);
    expect(currentState(h)).toEqual({ width: 100, height: 80, ops: [] });
    expect(isPristine(h)).toBe(true);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("desfaz e refaz na ordem", () => {
    const h2 = historyWith("a", "b");
    const h1 = undo(h2);
    expect(currentState(h1).ops.map((o) => (o.type === "text" ? o.text : ""))).toEqual(["a"]);
    expect(canRedo(h1)).toBe(true);
    expect(currentState(redo(h1))).toEqual(currentState(h2));
  });

  it("novo estado corta o ramo de refazer", () => {
    const h1 = undo(historyWith("a", "b"));
    const branched = pushState(h1, applyOp(currentState(h1), text("c")));
    expect(canRedo(branched)).toBe(false);
    expect(branched.states).toHaveLength(3);
  });

  it("desfazer tudo volta ao original mantendo o refazer", () => {
    const h = historyWith("a", "b", "c");
    const orig = undoAll(h);
    expect(isPristine(orig)).toBe(true);
    expect(currentState(orig)).toEqual(h.initial);
    expect(canRedo(orig)).toBe(true);
    expect(redo(orig).index).toBe(1);
  });

  it("não muta o histórico anterior", () => {
    const h = createHistory(10, 10);
    const snapshot = JSON.stringify(h);
    pushState(h, applyOp(currentState(h), text("x")));
    undoAll(pushState(h, applyOp(currentState(h), text("y"))));
    expect(JSON.stringify(h)).toBe(snapshot);
  });

  it("undo/redo/undoAll no limite devolvem o mesmo objeto", () => {
    const h = createHistory(10, 10);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(undoAll(h)).toBe(h);
  });
});
