import type { SessionRecorder, DomainEvent } from "../recording/index.js";
import type { Logger } from "../recording/index.js";

/**
 * Safely record a domain event, catching any errors to prevent
 * instrumentation from affecting request flow.
 */
export function safeRecord(
  recorder: SessionRecorder,
  event: DomainEvent,
  logger: Logger,
): void {
  try {
    recorder.record(event);
  } catch (err) {
    // Log only the error code/message, never event content or sensitive data
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`recorder.record() failed: ${message}`);
  }
}
