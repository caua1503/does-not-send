import type { SessionRecorder } from "./postgres-recorder.js";
import type { DomainEvent } from "./events.js";

export class NoopRecorder implements SessionRecorder {
  record(_event: DomainEvent): void {
    // No-op
  }

  stats(): { queued: number; dropped: number; failed: number } {
    return { queued: 0, dropped: 0, failed: 0 };
  }

  async close(_timeoutMs: number): Promise<void> {
    // No-op
  }
}
