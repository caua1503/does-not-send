import type { DomainEvent } from "./events.js";

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
  // Bun.sql errors expose .code (SQLSTATE) on PostgreSQL errors
  const code = (err as { code?: string }).code;
  if (!code) return false;
  return code.startsWith("08") || code.startsWith("53") || code.startsWith("57");
}
