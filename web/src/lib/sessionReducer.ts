import type { FileEntry } from "./api.ts";

export interface SessionState {
  files: FileEntry[];
}

export type WsEvent =
  | {
      type: "file:state-changed";
      fileId: string;
      state: FileEntry["state"];
      originalName: string;
      size: number;
      bytesReceived: number;
      mimeType?: string;
    }
  | {
      type: "file:progress";
      fileId: string;
      bytesReceived: number;
      size: number;
    };

const initialState: SessionState = { files: [] };

/**
 * Pure reducer — applies WebSocket events to session state.
 * No side effects.
 */
export function sessionReducer(state: SessionState, event: WsEvent): SessionState {
  if (event.type === "file:state-changed") {
    const existing = state.files.find((f) => f.id === event.fileId);
    if (existing) {
      // Update in-place
      return {
        files: state.files.map((f) =>
          f.id === event.fileId
            ? { ...f, state: event.state, bytesReceived: event.bytesReceived, size: event.size }
            : f,
        ),
      };
    }
    // Add new file entry
    const newFile: FileEntry = {
      id: event.fileId,
      originalName: event.originalName,
      mimeType: event.mimeType ?? "application/octet-stream",
      size: event.size,
      bytesReceived: event.bytesReceived,
      state: event.state,
      createdAt: new Date().toISOString(),
    };
    return { files: [...state.files, newFile] };
  }

  if (event.type === "file:progress") {
    if (!state.files.find((f) => f.id === event.fileId)) return state;
    return {
      files: state.files.map((f) =>
        f.id === event.fileId ? { ...f, bytesReceived: event.bytesReceived, size: event.size } : f,
      ),
    };
  }

  return state;
}

export { initialState };
