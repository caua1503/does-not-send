import { resolve } from "node:path";

export interface Config {
  host: string;
  port: number;
  tempDir: string;
  maxFileSize: number;
  maxFilesPerSession: number;
  sessionIdleTimeout: number;
  allowedOrigins: string[];
  publicBaseUrl: string;
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
  const sessionIdleTimeout = parsePositiveInt(
    "SESSION_IDLE_TIMEOUT",
    optionalEnv("SESSION_IDLE_TIMEOUT", "1800000"),
  );
  const allowedOriginsRaw = optionalEnv("ALLOWED_ORIGINS", "*");
  const allowedOrigins = allowedOriginsRaw.split(",").map((s) => s.trim());
  const publicBaseUrl = requireEnv("PUBLIC_BASE_URL");

  return {
    host,
    port,
    tempDir,
    maxFileSize,
    maxFilesPerSession,
    sessionIdleTimeout,
    allowedOrigins,
    publicBaseUrl,
  };
}
