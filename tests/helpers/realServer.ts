import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// The real default. A dev server already on 3000 makes startRealServer fail fast
// instead of silently testing a foreign process.
export const PORT = 3000;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const WS_BASE_URL = `ws://127.0.0.1:${PORT}`;

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RealServerHandle {
  stop(): Promise<void>;
  log(): string;
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Spawns the real `bun src/server.ts` on port 3000 with an isolated temp dir. */
export async function startRealServer(): Promise<RealServerHandle> {
  if (await isUp()) {
    throw new Error(`port ${PORT} already in use: refusing to test against a foreign server`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "dns-e2e-"));
  let output = "";
  // Requires `bun` on PATH, like the package scripts.
  const child = spawn("bun", ["run", "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PUBLIC_BASE_URL: BASE_URL,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      TEMP_DIR: tempDir,
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await rm(tempDir, { recursive: true, force: true });
      throw new Error(`server exited with ${child.exitCode}\n${output}`);
    }
    if (await isUp()) {
      let stopped = false;
      return {
        log: () => output,
        stop: async () => {
          if (stopped) return;
          stopped = true;
          if (child.exitCode === null) child.kill("SIGTERM");
          const exited = new Promise<void>((r) => child.once("exit", () => r()));
          await Promise.race([exited, delay(5000)]);
          if (child.exitCode === null) child.kill("SIGKILL");
          await rm(tempDir, { recursive: true, force: true });
        },
      };
    }
    await delay(100);
  }

  child.kill("SIGKILL");
  await rm(tempDir, { recursive: true, force: true });
  throw new Error(`server did not become healthy in 20s\n${output}`);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

export interface CreatedSession {
  id: string;
  ownerToken: string;
  computerToken: string;
  uploadToken: string;
  qrToken: string;
  visualId: string;
  shortId: string;
}

async function expectJson<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`${context}: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function createSession(): Promise<CreatedSession> {
  const res = await fetch(`${BASE_URL}/api/sessions`, { method: "POST" });
  return expectJson<CreatedSession>(res, "create session");
}

export async function pairSession(
  id: string,
  qrToken: string,
): Promise<{ phoneCredential: string; visualId: string }> {
  const res = await fetch(`${BASE_URL}/api/sessions/${id}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ qrToken }),
  });
  return expectJson(res, "pair session");
}

export async function getSessionInfo(
  id: string,
  token: string,
): Promise<{
  state: string;
  phonePresent: boolean;
  computerPresent: boolean;
  fileCount: number;
}> {
  const res = await fetch(`${BASE_URL}/api/sessions/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return expectJson(res, "get session");
}

export async function issueLoginCode(sessionId: string, ownerToken: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/sessions/${sessionId}/login-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
}

export async function joinByCode(
  sessionId: string,
  code: string,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/sessions/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, code }),
  });
}

export interface UploadedFile {
  id: string;
  originalName: string;
  size: number;
}

export async function uploadFile(
  sessionId: string,
  token: string,
  content: Buffer | string,
  filename: string,
): Promise<UploadedFile> {
  const form = new FormData();
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  form.append("file", new File([bytes], filename));
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await expectJson<{ files: UploadedFile[] }>(res, "upload file");
  return json.files[0]!;
}

export async function downloadFile(
  sessionId: string,
  fileId: string,
  token: string,
): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/files/${fileId}/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`download file: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadZip(sessionId: string, token: string): Promise<Uint8Array> {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/download.zip`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`download zip: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function sha256(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

export function openWs(sessionId: string, timeout = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE_URL}/api/sessions/${sessionId}/ws`);
    const t = setTimeout(() => {
      ws.terminate();
      reject(new Error("WS open timeout"));
    }, timeout);
    ws.once("open", () => {
      clearTimeout(t);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

export function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeout = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error("timeout waiting for WS message"));
    }, timeout);
    const onMsg = (data: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      clearTimeout(t);
      ws.off("message", onMsg);
      resolve(parsed);
    };
    ws.on("message", onMsg);
  });
}

export function waitForClose(
  ws: WebSocket,
  timeout = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 0, reason: "" });
      return;
    }
    const t = setTimeout(() => reject(new Error("timeout waiting for WS close")), timeout);
    ws.once("close", (code, reason) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/** Authenticates a socket and resolves once `auth_ok` arrives. */
export async function authenticateWs(
  ws: WebSocket,
  role: string,
  secret: string,
): Promise<Record<string, unknown>> {
  const ack = waitForMessage(ws, (m) => m.type === "auth_ok");
  ws.send(JSON.stringify({ type: "auth", role, secret }));
  return ack;
}

export async function connectWs(
  sessionId: string,
  role: string,
  secret: string,
): Promise<WebSocket> {
  const ws = await openWs(sessionId);
  try {
    await authenticateWs(ws, role, secret);
  } catch (err) {
    ws.close();
    throw err;
  }
  return ws;
}

export async function closeWs(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = waitForClose(ws).catch(() => undefined);
  ws.close();
  await closed;
}
