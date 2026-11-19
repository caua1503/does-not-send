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
      version?: number;
      kind?: "file" | "text";
    }
  | FileProgress;

export interface FileProgress {
  type: "file:progress";
  fileId: string;
  bytesReceived: number;
  size: number;
}

export function applyFileProgress(
  state: SessionState, progress: ReadonlyMap<string, FileProgress>,
): SessionState {
  let changed = false;
  const files = state.files.map((file) => {
    const update = progress.get(file.id);
    if (!update || file.state !== "receiving" || update.bytesReceived <= file.bytesReceived) return file;
    changed = true;
    return { ...file, bytesReceived: update.bytesReceived, size: update.size };
  });
  return changed ? { files } : state;
}

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
            ? {
                ...f,
                state: event.state,
                bytesReceived: event.bytesReceived,
                size: event.size,
                originalName: event.originalName,
                mimeType: event.mimeType ?? f.mimeType,
                version: event.version ?? f.version,
                kind: event.kind ?? f.kind,
              }
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
      version: event.version ?? 1,
      createdAt: new Date().toISOString(),
      kind: event.kind,
    };
    return { files: [...state.files, newFile] };
  }

  if (event.type === "file:progress") {
    return applyFileProgress(state, new Map([[event.fileId, event]]));
  }

  return state;
}

export { initialState };
