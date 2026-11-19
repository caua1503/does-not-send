import { EventEmitter } from "node:events";
import type { SessionFile } from "../types.js";

export type FileEventType = "file:state-changed" | "file:progress";

export interface FileStateChangedEvent {
  type: "file:state-changed";
  sessionId: string;
  fileId: string;
  state: "receiving" | "completed" | "failed";
  originalName: string;
  size: number;
  bytesReceived: number;
  version: number;
  mimeType: string;
  finishedAt?: string;
  extension: string;
  category: string;
  kind?: "file" | "text";
}

export interface FileProgressEvent {
  type: "file:progress";
  sessionId: string;
  fileId: string;
  bytesReceived: number;
  size: number;
}

export type FileEvent = FileStateChangedEvent | FileProgressEvent;

const progressIntervalMs = 200;
const serialized = new WeakMap<FileEvent, string>();

export function serializeFileEvent(event: FileEvent): string {
  const payload = serialized.get(event) ?? JSON.stringify(event);
  serialized.set(event, payload);
  return payload;
}

class TypedEventEmitter extends EventEmitter {
  private pendingProgress = new Map<SessionFile, string>();
  private progressTimer: ReturnType<typeof setTimeout> | undefined;

  markProgress(sessionId: string, file: SessionFile): void {
    this.pendingProgress.set(file, sessionId);
    if (this.progressTimer !== undefined) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined;
      const batch = this.pendingProgress;
      this.pendingProgress = new Map();
      for (const [item, id] of batch) {
        if (item.state !== "receiving") continue;
        this.emitFileEvent({
          type: "file:progress",
          sessionId: id,
          fileId: item.id,
          bytesReceived: item.bytesReceived,
          size: item.size,
        });
      }
    }, progressIntervalMs);
    this.progressTimer.unref();
  }

  emitFileEvent(event: FileEvent): void {
    this.emit(event.type, event);
    this.emit(`${event.type}:${event.sessionId}`, event);
  }

  onFileEvent(type: FileEventType, sessionId: string, handler: (event: FileEvent) => void): void {
    this.on(`${type}:${sessionId}`, handler);
  }

  offFileEvent(type: FileEventType, sessionId: string, handler: (event: FileEvent) => void): void {
    this.off(`${type}:${sessionId}`, handler);
  }
}

export const fileEvents = new TypedEventEmitter();
