import { InvalidTransitionError } from "./errors.js";

export type SessionState =
  | "WAITING"
  | "PAIRED"
  | "TRANSFERRING"
  | "DISCONNECTED"
  | "CLOSED";

export const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  WAITING: ["PAIRED", "CLOSED"],
  PAIRED: ["TRANSFERRING", "DISCONNECTED", "CLOSED"],
  TRANSFERRING: ["PAIRED", "DISCONNECTED", "CLOSED"],
  DISCONNECTED: ["PAIRED", "CLOSED"],
  CLOSED: [],
};

export function transition(
  session: { state: SessionState },
  to: SessionState,
): void {
  const allowed = TRANSITIONS[session.state];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidTransitionError(session.state, to);
  }
  session.state = to;
}
