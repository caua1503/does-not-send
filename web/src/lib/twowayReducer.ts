import type { DeviceKind, FileEntry, ParticipantInfo } from "./api.ts";

export interface TwowayItem {
  id: string;
  kind: "file" | "text";
  name: string;
  size: number;
  senderId: string;
  senderName: string;
  origin: DeviceKind;
  createdAt: string;
}

export interface TwowayState {
  participants: ParticipantInfo[];
  items: TwowayItem[];
}

export type TwowayEvent =
  | { type: "participants:list"; participants: ParticipantInfo[] }
  | { type: "participant:joined"; id: string; name: string; device: DeviceKind }
  | { type: "participant:left"; id: string }
  | {
      type: "item:added";
      id: string;
      kind: "file" | "text";
      name: string;
      size: number;
      senderId: string;
      senderName: string;
      origin: DeviceKind;
      createdAt: string;
    }
  | { type: "item:deleted"; id: string }
  | { type: "session:closed" }
  | { type: "items:loaded"; items: TwowayItem[] };

export type TwowayServerEvent = Exclude<TwowayEvent, { type: "items:loaded" }>;

export const initialTwowayState: TwowayState = { participants: [], items: [] };

function upsertParticipant(
  participants: ParticipantInfo[],
  participant: ParticipantInfo,
): ParticipantInfo[] {
  const exists = participants.some((current) => current.id === participant.id);
  if (!exists) return [...participants, participant];
  return participants.map((current) =>
    current.id === participant.id ? participant : current,
  );
}

function upsertItem(items: TwowayItem[], item: TwowayItem): TwowayItem[] {
  const exists = items.some((current) => current.id === item.id);
  if (!exists) return [...items, item];
  return items.map((current) => (current.id === item.id ? item : current));
}

export function twowayReducer(state: TwowayState, event: TwowayEvent): TwowayState {
  switch (event.type) {
    case "participants:list":
      return { ...state, participants: event.participants };
    case "participant:joined":
      return {
        ...state,
        participants: upsertParticipant(state.participants, {
          id: event.id,
          name: event.name,
          device: event.device,
        }),
      };
    case "participant:left":
      return {
        ...state,
        participants: state.participants.filter((participant) => participant.id !== event.id),
      };
    case "item:added":
      return {
        ...state,
        items: upsertItem(state.items, {
          id: event.id,
          kind: event.kind,
          name: event.name,
          size: event.size,
          senderId: event.senderId,
          senderName: event.senderName,
          origin: event.origin,
          createdAt: event.createdAt,
        }),
      };
    case "item:deleted":
      return { ...state, items: state.items.filter((item) => item.id !== event.id) };
    case "session:closed":
      return initialTwowayState;
    case "items:loaded": {
      // History may resolve after a live event: keep what only arrived by WS.
      const historyIds = new Set(event.items.map((item) => item.id));
      return {
        ...state,
        items: [...event.items, ...state.items.filter((item) => !historyIds.has(item.id))],
      };
    }
  }
}

export interface Viewer {
  participantId?: string | null;
  isHost: boolean;
}

export function canDownloadItem(_item: TwowayItem, _viewer: Viewer): boolean {
  return true;
}

export function canDeleteItem(item: TwowayItem, viewer: Viewer): boolean {
  if (viewer.isHost) return true;
  return Boolean(viewer.participantId) && item.senderId === viewer.participantId;
}

export function canCloseSession(viewer: Viewer): boolean {
  return viewer.isHost;
}

function mimeTypeFor(name: string, kind: "file" | "text"): string {
  if (kind === "text") return "text/plain; charset=utf-8";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico"].includes(ext)) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (["mp4", "webm", "ogg", "mov", "avi"].includes(ext)) return `video/${ext}`;
  if (["mp3", "wav", "flac", "aac", "opus", "oga"].includes(ext)) return `audio/${ext}`;
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export function itemToFileEntry(item: TwowayItem): FileEntry {
  return {
    id: item.id,
    originalName: item.name,
    mimeType: mimeTypeFor(item.name, item.kind),
    size: item.size,
    bytesReceived: item.size,
    state: "completed",
    version: 1,
    createdAt: item.createdAt,
    kind: item.kind,
    senderId: item.senderId,
    senderName: item.senderName,
    origin: item.origin,
  };
}

export function fileEntryToTwowayItem(file: FileEntry): TwowayItem {
  return {
    id: file.id,
    kind: file.kind === "text" ? "text" : "file",
    name: file.originalName,
    size: file.size,
    senderId: file.senderId ?? "",
    senderName: file.senderName ?? "",
    origin: file.origin ?? "phone",
    createdAt: file.createdAt,
  };
}
