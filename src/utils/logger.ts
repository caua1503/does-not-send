import type { FastifyBaseLogger } from "fastify";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

export function createLogEntry(
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

/** Fastify-compatible structured logger factory */
export function createLogger(): FastifyBaseLogger {
  // Fastify uses pino by default, which outputs structured JSON.
  // We rely on Fastify's built-in pino logger configured in app.ts.
  // This module provides helpers for application-level structured logging.
  return undefined as unknown as FastifyBaseLogger; // placeholder, Fastify creates the real one
}
