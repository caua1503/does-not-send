/**
 * Domain Events — Union Discriminada
 * 
 * Eventos emitidos pelo domínio de sessão durante operações.
 * Cada evento contém timestamp (number, epoch ms) fornecido pelo Clock injetado.
 */

export type SessionCreated = {
  type: "session_created";
  sessionId: string;
  visualId: string;
  computerIp: string;
  timestamp: number;
};

export type SessionPaired = {
  type: "session_paired";
  sessionId: string;
  phoneIp: string;
  userAgent: string;
  timestamp: number;
};

export type SessionClosed = {
  type: "session_closed";
  sessionId: string;
  closeReason: string;
  timestamp: number;
};

export type TransferStarted = {
  type: "transfer_started";
  sessionId: string;
  transferId: string;
  fileName: string;
  extension: string;
  mime: string;
  size: number;
  phoneIp: string;
  timestamp: number;
};

export type TransferFinished = {
  type: "transfer_finished";
  sessionId: string;
  transferId: string;
  status: "done" | "aborted" | "discarded";
  timestamp: number;
};

export type PairingRefused = {
  type: "pairing_refused";
  sessionId: string;
  reason: string;
  phoneIp: string;
  userAgent: string;
  timestamp: number;
};

export type QrReuseBlocked = {
  type: "qr_reuse_blocked";
  sessionId: string;
  phoneIp: string;
  userAgent: string;
  timestamp: number;
};

export type PhoneLost = {
  type: "phone_lost";
  sessionId: string;
  timestamp: number;
};

export type PhoneBack = {
  type: "phone_back";
  sessionId: string;
  timestamp: number;
};

export type DomainEvent =
  | SessionCreated
  | SessionPaired
  | SessionClosed
  | TransferStarted
  | TransferFinished
  | PairingRefused
  | QrReuseBlocked
  | PhoneLost
  | PhoneBack;
