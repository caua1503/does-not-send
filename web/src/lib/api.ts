/**
 * Typed API client.
 */

import { BASE_URL as BASE } from "./base.ts";

export type DeviceKind = "phone" | "desktop";
export type SessionMode = "oneway" | "twoway";

export interface ParticipantInfo {
  id: string;
  name: string;
  device: DeviceKind;
}

export interface Session {
  id: string;
  mode?: SessionMode;
  hostId?: string;
  participants?: ParticipantInfo[];
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

export type InviteState = "valid" | "expired" | "used" | "revoked";
export type InviteMode = "single" | "multi";

export interface InvitePreview {
  state: InviteState;
  sessionId: string;
}

export interface InviteSummary {
  code: string;
  mode: InviteMode;
  state: InviteState;
}

export interface CreatedInvite {
  code: string;
  url: string;
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
  kind?: "file" | "text";
  senderId?: string;
  senderName?: string;
  origin?: DeviceKind;
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

export interface CreateSessionInput {
  mode?: SessionMode;
  name?: string;
  device?: DeviceKind;
}

/** POST /api/sessions → Session */
export async function createSession(input: CreateSessionInput = {}): Promise<Session> {
  const res = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
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

/** GET /api/invites/:code — validates without consuming. */
export async function getInvite(code: string): Promise<InvitePreview> {
  const res = await apiFetch(`/api/invites/${encodeURIComponent(code)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to get invite: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<InvitePreview>;
}

/** POST /api/invites/:code/redeem — consumes single invites per device. */
export async function redeemInvite(code: string, deviceId: string): Promise<PairResponse> {
  const res = await apiFetch(`/api/invites/${encodeURIComponent(code)}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to redeem invite: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<PairResponse>;
}

/** GET /api/sessions/:id/invites — host only. */
export async function listInvites(id: string, token: string): Promise<InviteSummary[]> {
  const res = await apiFetch(`/api/sessions/${id}/invites`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to list invites: ${res.status}`, res.status, data.code);
  }
  const data = (await res.json()) as { invites: InviteSummary[] };
  return data.invites;
}

/** POST /api/sessions/:id/invites — host only. */
export async function createInvite(
  id: string,
  token: string,
  mode: InviteMode,
): Promise<CreatedInvite> {
  const res = await apiFetch(`/api/sessions/${id}/invites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to create invite: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<CreatedInvite>;
}

/** DELETE /api/sessions/:id/invites/:code — host only. */
export async function revokeInvite(
  id: string,
  code: string,
  token: string,
): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}/invites/${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to revoke invite: ${res.status}`, res.status, data.code);
  }
}

export interface JoinResponse {
  success: boolean;
  sessionId: string;
  mode: SessionMode;
  visualId?: string;
  hostId?: string;
  phoneCredential?: string;
}

interface JoinErrorBody extends PairErrorBody {
  sessionId?: string;
}

/** Thrown by joinWithCode; `status` and `code` decide the user-facing message. */
export class JoinError extends Error {
  status: number;
  code?: string;
  sessionId?: string;

  constructor(status: number, code?: string, sessionId?: string) {
    super(`Join failed: ${status}`);
    this.name = "JoinError";
    this.status = status;
    this.code = code;
    this.sessionId = sessionId;
  }
}

/** POST /api/sessions/join — manual entry shared by oneway and twoway. */
export async function joinWithCode(sessionId: string, code: string): Promise<JoinResponse> {
  const res = await apiFetch("/api/sessions/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, code }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as JoinErrorBody;
    throw new JoinError(res.status, data.code, data.sessionId);
  }
  return res.json() as Promise<JoinResponse>;
}

export interface TwowayJoinInput {
  name: string;
  device: DeviceKind;
  qrToken?: string;
  code?: string;
}

export interface TwowayJoinResponse {
  sessionId: string;
  mode: SessionMode;
  participant: ParticipantInfo;
  credential: string;
}

/** POST /api/sessions/:id/participants — twoway room entry. */
export async function joinTwowaySession(
  id: string,
  input: TwowayJoinInput,
): Promise<TwowayJoinResponse> {
  const res = await apiFetch(`/api/sessions/${id}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to join session: ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<TwowayJoinResponse>;
}

/** DELETE /api/sessions/:id/files/:fileId — author or host. */
export async function deleteItem(
  sessionId: string,
  fileId: string,
  token: string,
): Promise<void> {
  const res = await apiFetch(`/api/sessions/${sessionId}/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as PairErrorBody;
    throw new ApiError(data.error || `Failed to delete item: ${res.status}`, res.status, data.code);
  }
}

/** POST /api/sessions/:id/login-code — issue a fresh manual login code on demand. */
export async function requestLoginCode(id: string, token: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}/login-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to request login code: ${res.status}`);
}

export interface SessionInfo {
  id: string;
  mode?: SessionMode;
  hostId?: string;
  participants?: ParticipantInfo[];
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

/** POST /api/sessions/:id/leave — host closes and wipes, guest just leaves */
export async function leaveSession(id: string, token: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${id}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to leave session: ${res.status}`);
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
