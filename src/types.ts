/** Core domain types */

import type { SessionState } from "./session/states.js";

export type { SessionState } from "./session/states.js";
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
  computerTokenHash: string;
  phoneCredentialHash: string | null;
  ownerToken?: string;
  uploadToken?: string;
  visualId: string;
  shortId: string;
  qrTokenHash: string | null;
  qrConsumedAt: string | null;
  isPaired: boolean;
  pairedAt?: string | null;
  phoneDisconnectedAt?: string;
  state: SessionState;
  activeUploads: number;
  createdAt: string;
  lastActivity: string;
  files: SessionFile[];
}
