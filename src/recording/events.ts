import type { closeReasonEnum, transferStatusEnum, categoryEnum } from "../db/schema.js";

type CloseReason = (typeof closeReasonEnum.enumValues)[number];
type TransferStatus = Exclude<(typeof transferStatusEnum.enumValues)[number], "receiving">;
type Category = (typeof categoryEnum.enumValues)[number];

export interface SessionCreated {
  type: "session_created";
  at: Date;
  sessionId: string;
  visualId: string;
  computerIp?: string;
  /** Absent means the row predates the mode column. */
  mode?: "oneway" | "twoway";
}

/** One row per participant membership; reconnects never emit this again. */
export interface ParticipantJoined {
  type: "participant_joined";
  at: Date;
  sessionId: string;
  participantId: string;
  role: "host" | "guest";
}

export interface SessionPaired {
  type: "session_paired";
  at: Date;
  sessionId: string;
  phoneIp?: string;
}

export interface SessionClosed {
  type: "session_closed";
  at: Date;
  sessionId: string;
  reason: CloseReason;
}

export interface TransferStarted {
  type: "transfer_started";
  at: Date;
  id: string;
  sessionId: string;
  name: string;
  extension: string;
  mime: string;
  category: Category;
  size: number;
  /** Client-declared pre-compression size; absent when unknown/invalid. */
  originalSize?: number | null;
}

export interface TransferFinished {
  type: "transfer_finished";
  at: Date;
  id: string;
  status: TransferStatus;
  size: number;
  /** Present only on edits/replacements, which emit no transfer_started. */
  originalSize?: number | null;
}

export interface PairingRefused {
  type: "pairing_refused";
  at: Date;
  ip?: string;
  sessionId?: string;
}

export type DomainEvent =
  | SessionCreated
  | ParticipantJoined
  | SessionPaired
  | SessionClosed
  | TransferStarted
  | TransferFinished
  | PairingRefused;
