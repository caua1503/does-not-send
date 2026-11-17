/** Core domain types */

import type { SessionState } from "./session/states.js";

export type { SessionState } from "./session/states.js";
export type { SessionRole } from "./session/auth.js";
export type FileState = "receiving" | "completed" | "failed";
export type SessionMode = "oneway" | "twoway";
export type DeviceKind = "phone" | "desktop";

export interface Participant {
  id: string;
  name: string;
  device: DeviceKind;
  /** Never sent to clients, only the raw credential is handed out once. */
  credentialHash: string;
  joinedAt: string;
}

export type ParticipantInfo = Pick<Participant, "id" | "name" | "device">;

export interface SessionFile {
  id: string;
  originalName: string;
  storageName: string;
  mimeType: string;
  size: number;
  bytesReceived: number;
  /** Client-declared size before compression; null when unknown. */
  originalSize?: number | null;
  state: FileState;
  createdAt: string;
  startedAt: string; // Alias para createdAt (usado em eventos)
  finishedAt?: string; // Timestamp quando completed/failed
  version: number; // 1 no primeiro upload, +1 a cada substituição
  extension: string; // Calculado de originalName
  category: string; // Calculado de extension+mimeType
  kind?: "file" | "text"; // "text": enviado pelo widget de texto
  senderId?: string;
  senderName?: string;
  origin?: DeviceKind;
}

export interface Session {
  id: string;
  hostTokenHash: string;
  guestCredentialHash: string | null;
  ownerToken?: string;
  uploadToken?: string;
  visualId: string;
  shortId: string;
  qrTokenHash: string | null;
  pairedAt?: string | null;
  state: SessionState;
  activeUploads: number;
  createdAt: string;
  lastActivity: string;
  files: SessionFile[];
  lastSeen: {
    host: number | null;
    guest: number | null;
  };
  closedReason?: string | null;
  computerIp?: string | null; // IP normalizado do computador
  phoneIp?: string | null; // IP normalizado do celular
  closedAt?: string | null; // ISO 8601 timestamp de fechamento
  /** Missing means `oneway`, the historical behavior. */
  mode?: SessionMode;
  /** Host participant id (twoway). */
  hostId?: string;
  participants?: Participant[];
}
