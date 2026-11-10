import type { DomainEvent } from "./events.js";

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
}

export interface Store {
  /**
   * Persist a batch of events. Throws on any error (transient or constraint violation).
   * The caller is responsible for error classification and retry logic.
   */
  apply(events: DomainEvent[]): Promise<void>;
}

/**
 * Custom error for constraint violations (SQLSTATE class 23: integrity constraint).
 * Used to signal that the batch should be reprocessed item-by-item.
 */
export class ConstraintViolationError extends Error {
  constructor(
    message: string,
    public readonly originalError: unknown,
  ) {
    super(message);
    this.name = "ConstraintViolationError";
  }
}

/**
 * Check if an error is transient (connection, resource, or canceled operation).
 * Transient errors: SQLSTATE classes 08 (connection), 53 (resources), 57 (operator intervention/canceled).
 * @returns true if error is transient and should be retried at the batch level.
 */
export function isTransientError(err: unknown): boolean {
  // Driver errors are wrapped by Drizzle: SQLSTATE (errno) and the Bun code live
  // on the cause; a refused connection is exactly the case retries exist for.
  const source = (err as { cause?: { code?: unknown; errno?: unknown } }).cause;
  const code = (err as { code?: unknown }).code ?? source?.code;
  if (typeof code === "string" && code.startsWith("ERR_POSTGRES_CONNECTION")) return true;
  // Bun.sql errors expose .code (SQLSTATE) on PostgreSQL errors; Drizzle wraps
  // those as well, with the SQLSTATE on cause.errno.
  const sqlState =
    (err as { errno?: unknown }).errno ??
    source?.errno ??
    (typeof code === "string" ? code : undefined);
  if (typeof sqlState !== "string") return false;
  return sqlState.startsWith("08") || sqlState.startsWith("53") || sqlState.startsWith("57");
}
