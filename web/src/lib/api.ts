/**
 * Typed API client.
 * BASE_URL is injected by Vite at build time via __BASE_URL__ define.
 * Falls back to empty string (relative paths) for dev server proxy.
 */

declare const __BASE_URL__: string;

const BASE = typeof __BASE_URL__ !== "undefined" ? __BASE_URL__ : "";

export interface Session {
  id: string;
  ownerToken: string;
  uploadToken: string;
  createdAt: string;
}

export interface FileEntry {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  bytesReceived: number;
  state: "receiving" | "completed" | "failed";
  createdAt: string;
}

interface FileListResponse {
  files: FileEntry[];
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, init);
  return res;
}

/** POST /api/sessions → Session */
export async function createSession(): Promise<Session> {
  const res = await apiFetch("/api/sessions", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json() as Promise<Session>;
}

/** DELETE /api/sessions/:id (ownerToken via query param for sendBeacon compat) */
export async function deleteSession(id: string, token: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}?token=${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete session: ${res.status}`);
  }
}

/** POST /api/sessions/:id/heartbeat */
export async function heartbeat(id: string, token: string): Promise<void> {
  await apiFetch(`/api/sessions/${id}/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** GET /api/sessions/:id/files */
export async function listFiles(id: string, token: string): Promise<FileEntry[]> {
  const res = await apiFetch(`/api/sessions/${id}/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to list files: ${res.status}`);
  const data = (await res.json()) as FileListResponse;
  return data.files;
}

/** URL for inline preview (used in <img>, <video>, <audio>, <iframe>) */
export function previewUrl(sessionId: string, fileId: string, token: string): string {
  return `${BASE}/api/sessions/${sessionId}/files/${fileId}/preview?token=${encodeURIComponent(token)}`;
}

/** URL for individual file download */
export function downloadUrl(sessionId: string, fileId: string, token: string): string {
  return `${BASE}/api/sessions/${sessionId}/files/${fileId}/download?token=${encodeURIComponent(token)}`;
}

/** URL for ZIP download of all completed files */
export function zipUrl(sessionId: string, token: string): string {
  return `${BASE}/api/sessions/${sessionId}/download.zip?token=${encodeURIComponent(token)}`;
}

/** WebSocket URL for session events */
export function wsUrl(sessionId: string, token: string): string {
  const base = BASE || window.location.origin;
  const ws = base.replace(/^http/, "ws");
  return `${ws}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`;
}
