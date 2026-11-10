import { resolve } from "node:path";
import { DEFAULT_TIMING_CONFIG } from "../session/timing.js";
// No cycle: nothing under src/session/ imports utils/config.
import { DEFAULT_CLEANUP_RETRY } from "../session/store.js";

/**
 * Resolved admin credentials. `undefined` means the /admin routes are not
 * registered at all (they must not even resolve to a 404 JSON route).
 */
export interface AdminConfig {
  user: string;
  password: string;
  /** IANA timezone used by the dashboard; validated before it is exported. */
  tz: string;
}

export interface Config {
  host: string;
  port: number;
  tempDir: string;
  maxFileSize: number;
  maxFilesPerSession: number;
  allowedOrigins: string[];
  publicBaseUrl: string;
  heartbeatTimeoutMs: number;
  wsAuthTimeoutMs: number;
  cleanupMaxAttempts: number;
  cleanupInitialDelayMs: number;
  admin?: AdminConfig;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value;
}

const ADMIN_DEFAULT_USER = "admin";
const ADMIN_DEFAULT_PASSWORD = "admin";
const ADMIN_MIN_PRODUCTION_PASSWORD = 12;
/** Default admin timezone, used when ADMIN_TZ is unset or invalid. */
export const DEFAULT_TZ = "America/Sao_Paulo";

/** Falls back to UTC when the value is not a valid IANA zone (never throws at boot). */
function resolveTimeZone(raw: string | undefined): string {
  const candidate = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

/**
 * Production rule: /admin only exists with a password that is neither the
 * default nor shorter than 12 characters. The dev fallback is admin/admin.
 */
export function resolveAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig | undefined {
  const isProduction = env.NODE_ENV === "production";
  const user = env.ADMIN_USER && env.ADMIN_USER !== "" ? env.ADMIN_USER : ADMIN_DEFAULT_USER;
  const password = env.ADMIN_PASSWORD ?? "";
  const tz = resolveTimeZone(env.ADMIN_TZ);

  if (isProduction) {
    if (password === "" || password === ADMIN_DEFAULT_PASSWORD) return undefined;
    if (password.length < ADMIN_MIN_PRODUCTION_PASSWORD) return undefined;
    return { user, password, tz };
  }

  return {
    user,
    password: password !== "" ? password : ADMIN_DEFAULT_PASSWORD,
    tz,
  };
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

export function loadConfig(): Config {
  const host = optionalEnv("HOST", "0.0.0.0");
  const port = parsePositiveInt("PORT", optionalEnv("PORT", "3000"));
  const tempDir = resolve(optionalEnv("TEMP_DIR", "./tmp/uploads"));
  const maxFileSize = parsePositiveInt("MAX_FILE_SIZE", optionalEnv("MAX_FILE_SIZE", "5368709120"));
  const maxFilesPerSession = parsePositiveInt(
    "MAX_FILES_PER_SESSION",
    optionalEnv("MAX_FILES_PER_SESSION", "50"),
  );
  const allowedOriginsRaw = optionalEnv("ALLOWED_ORIGINS", "*");
  const allowedOrigins = allowedOriginsRaw.split(",").map((s) => s.trim());
  const publicBaseUrl = requireEnv("PUBLIC_BASE_URL");
  const heartbeatTimeoutMs = parsePositiveInt(
    "HEARTBEAT_TIMEOUT_MS",
    optionalEnv("HEARTBEAT_TIMEOUT_MS", String(DEFAULT_TIMING_CONFIG.heartbeatTimeoutMs)),
  );
  const wsAuthTimeoutMs = parsePositiveInt(
    "WS_AUTH_TIMEOUT_MS",
    optionalEnv("WS_AUTH_TIMEOUT_MS", String(DEFAULT_TIMING_CONFIG.wsAuthTimeoutMs)),
  );
  const cleanupMaxAttempts = parsePositiveInt(
    "CLEANUP_MAX_ATTEMPTS",
    optionalEnv("CLEANUP_MAX_ATTEMPTS", String(DEFAULT_CLEANUP_RETRY.maxAttempts)),
  );
  const cleanupInitialDelayMs = parsePositiveInt(
    "CLEANUP_INITIAL_DELAY_MS",
    optionalEnv("CLEANUP_INITIAL_DELAY_MS", String(DEFAULT_CLEANUP_RETRY.initialDelayMs)),
  );
  let admin: AdminConfig | undefined;
  try {
    admin = resolveAdminConfig();
  } catch {
    admin = undefined;
  }

  return {
    host,
    port,
    tempDir,
    maxFileSize,
    maxFilesPerSession,
    allowedOrigins,
    publicBaseUrl,
    heartbeatTimeoutMs,
    wsAuthTimeoutMs,
    cleanupMaxAttempts,
    cleanupInitialDelayMs,
    ...(admin ? { admin } : {}),
  };
}
