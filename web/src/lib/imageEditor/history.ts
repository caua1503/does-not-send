/**
 * Undo/redo history. Pure and immutable: every function returns a new object.
 * `initial` is the light-weight original (size + zero ops), not image pixels,
 * so "undo all" costs nothing.
 */

import type { EditorState, History } from "./types.ts";

export function createHistory(width: number, height: number): History {
  if (!(width > 0) || !(height > 0)) throw new Error(`invalid size ${width}x${height}`);
  const initial: EditorState = { width, height, ops: [] };
  return { initial, states: [initial], index: 0 };
}

export function currentState(history: History): EditorState {
  return history.states[history.index]!;
}

export function canUndo(history: History): boolean {
  return history.index > 0;
}

export function canRedo(history: History): boolean {
  return history.index < history.states.length - 1;
}

/** Push a new state. Drops the redo tail. */
export function pushState(history: History, state: EditorState): History {
  const states = history.states.slice(0, history.index + 1);
  states.push(state);
  return { initial: history.initial, states, index: states.length - 1 };
}

export function undo(history: History): History {
  if (!canUndo(history)) return history;
  return { ...history, index: history.index - 1 };
}

export function redo(history: History): History {
  if (!canRedo(history)) return history;
  return { ...history, index: history.index + 1 };
}

/** Back to the original image, keeping the redo tail intact. */
export function undoAll(history: History): History {
  return history.index === 0 ? history : { ...history, index: 0 };
}

export function isPristine(history: History): boolean {
  return history.index === 0;
}
