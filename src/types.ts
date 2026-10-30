/** Core domain types */

export type SessionState = "active" | "closed";
export type FileState = "receiving" | "completed" | "failed";

export interface SessionFile {
  id: string;
  originalName: string;
  storageName: string;
  mimeType: string;
  size: number;
  bytesReceived: number;
  state: FileState;
  createdAt: string;
}

export interface Session {
  id: string;
  ownerToken: string;
  uploadToken: string;
  state: SessionState;
  createdAt: string;
  lastActivity: string;
  files: SessionFile[];
}
