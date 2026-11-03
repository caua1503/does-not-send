import { SessionStore, type SessionStoreOptions } from "../session/store.js";
import { SystemClock } from "../session/clock.js";

export class SessionRepository extends SessionStore {
  constructor(options?: Partial<SessionStoreOptions>) {
    super({
      clock: options?.clock ?? new SystemClock(),
      tempDir: options?.tempDir ?? "/tmp",
      timingConfig: options?.timingConfig,
    });
  }
}
