import { EventEmitter } from "node:events";

export type FileEventType = "file:state-changed" | "file:progress";

export interface FileStateChangedEvent {
  type: "file:state-changed";
  sessionId: string;
  fileId: string;
  state: "receiving" | "completed" | "failed";
  originalName: string;
  size: number;
  bytesReceived: number;
}

export interface FileProgressEvent {
  type: "file:progress";
  sessionId: string;
  fileId: string;
  bytesReceived: number;
  size: number;
}

export type FileEvent = FileStateChangedEvent | FileProgressEvent;

class TypedEventEmitter extends EventEmitter {
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

  /** Emit when a session is closed (triggers WS close) */
  emitSessionClosed(sessionId: string): void {
    this.emit("session:closed", sessionId);
  }
}

export const fileEvents = new TypedEventEmitter();
