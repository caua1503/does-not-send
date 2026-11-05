import type { SessionRecorder } from "./postgres-recorder.js";
import type { DomainEvent } from "./events.js";

export class InMemoryRecorder implements SessionRecorder {
  private events: DomainEvent[] = [];

  record(event: DomainEvent): void {
    this.events.push(event);
  }

  stats(): { queued: number; dropped: number; failed: number } {
    return { queued: this.events.length, dropped: 0, failed: 0 };
  }

  async close(_timeoutMs: number): Promise<void> {
    // No-op
  }

  getEvents(): readonly DomainEvent[] {
    return this.events;
  }
}
