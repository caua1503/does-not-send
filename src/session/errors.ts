import type { SessionState } from "./states.js";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: SessionState,
    public readonly to: SessionState,
  ) {
    super(`Invalid session transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export type PairingErrorCode = "INVALID" | "NOT_FOUND" | "CLOSED";

export class PairingError extends Error {
  constructor(public readonly code: PairingErrorCode) {
    super(`Pairing error: ${code}`);
    this.name = "PairingError";
  }
}
