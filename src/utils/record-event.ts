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
    // Log only the error code to avoid leaking sensitive data in messages
    const code =
      err instanceof Error
        ? ((err as { code?: unknown }).code as string | undefined) ?? err.constructor.name
        : "UNKNOWN";
    logger.error(`recorder.record() failed: ${code}`);
  }
}
