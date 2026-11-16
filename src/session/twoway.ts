import type { SessionFile } from "../types.js";

/** Runtime defaults; every value can be overridden by env in config.ts. */
export const TWOWAY_DEFAULTS = {
  maxParticipants: 10,
  maxTotalBytes: 10 * 1024 * 1024 * 1024,
  idleTimeoutMs: 30 * 60 * 1000,
} as const;

export interface ItemAddedEvent {
  type: "item:added";
  id: string;
  kind: "file" | "text";
  name: string;
  size: number;
  senderId: string;
  senderName: string;
  origin: "phone" | "desktop";
  createdAt: string;
}

export function itemAddedEvent(file: SessionFile): ItemAddedEvent | null {
  if (!file.senderId || !file.senderName || !file.origin) return null;
  return {
    type: "item:added",
    id: file.id,
    kind: file.kind === "text" ? "text" : "file",
    name: file.originalName,
    size: file.size,
    senderId: file.senderId,
    senderName: file.senderName,
    origin: file.origin,
    createdAt: file.createdAt,
  };
}
