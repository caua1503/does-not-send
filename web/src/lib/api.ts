/**
 * Typed API client.
 */

import { BASE_URL as BASE } from "./base.ts";

export interface Session {
  id: string;
  computerToken?: string;
  ownerToken: string;
  uploadToken?: string;
  qrToken?: string;
  visualId?: string;
  shortId?: string;
  createdAt: string;
}

export interface PairResponse {
  success: boolean;
  phoneCredential: string;
  visualId?: string;
  shortId?: string;
  state: "WAITING" | "PAIRED" | "TRANSFERRING" | "DISCONNECTED" | "CLOSED" | string;
  pairedAt: string;
}

export interface PairErrorBody {
  error?: string;
  code?: string;
  statusCode?: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface FileEntry {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  bytesReceived: number;
  state: "receiving" | "completed" | "failed";
  version: number;
  createdAt: string;
}

interface FileListResponse {
  files: FileEntry[];
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base =
    BASE ||
    (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "http://localhost");
  const res = await fetch(`${base}${path}`, init);
  return res;
}

/** POST /api/sessions → Session */
export async function createSession(): Promise<Session> {
  const res = await apiFetch("/api/sessions", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json() as Promise<Session>;
}

/** POST /api/sessions/:id/pair */
export async function pairSession(id: string, qrToken: string): Promise<PairResponse> {
  const res = await apiFetch(`/api/sessions/${id}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrToken }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to pair: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<PairResponse>;
}

export interface JoinResponse {
  success: boolean;
  phoneCredential: string;
}

/** Thrown by joinWithCode; `status` alone decides the user-facing message. */
export class JoinError extends Error {
  status: number;

  constructor(status: number) {
    super(`Join failed: ${status}`);
    this.name = "JoinError";
    this.status = status;
  }
}

/** POST /api/sessions/join — manual login, same credential the QR delivers. */
export async function joinWithCode(sessionId: string, code: string): Promise<JoinResponse> {
  const res = await apiFetch("/api/sessions/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, code }),
  });
  if (!res.ok) throw new JoinError(res.status);
  return res.json() as Promise<JoinResponse>;
}

export interface SessionInfo {
  id: string;
  visualId?: string;
  shortId?: string;
  state: "WAITING" | "PAIRED" | "TRANSFERRING" | "DISCONNECTED" | "CLOSED" | string;
  phonePresent?: boolean;
  computerPresent?: boolean;
  activeUploads?: number;
  createdAt: string;
  lastActivity?: string;
  fileCount: number;
}

/** GET /api/sessions/:id */
export async function getSession(id: string, token: string): Promise<SessionInfo> {
  const res = await apiFetch(`/api/sessions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to get session: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<SessionInfo>;
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
export function previewUrl(sessionId: string, fileId: string, token: string, version?: number): string {
  const v = version === undefined ? "" : `&v=${version}`;
  return `${BASE}/api/sessions/${sessionId}/files/${fileId}/preview?token=${encodeURIComponent(token)}${v}`;
}

/** URL for individual file download */
export function downloadUrl(sessionId: string, fileId: string, token: string, version?: number): string {
  const v = version === undefined ? "" : `&v=${version}`;
  return `${BASE}/api/sessions/${sessionId}/files/${fileId}/download?token=${encodeURIComponent(token)}${v}`;
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
