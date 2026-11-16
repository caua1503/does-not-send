import { randomUUID } from "node:crypto";
import type { Config } from "../utils/config.js";
import type { SessionStore } from "../session/store.js";
import type { Clock } from "../session/clock.js";
import type { DeviceKind, Participant, ParticipantInfo, Session } from "../types.js";
import { generateSecret, verifyHash } from "../session/auth.js";
import { hashToken } from "../session/pairing.js";
import { sessionMode } from "../session/permissions.js";
import {
  normalizeParticipantName,
  participantsList,
  toParticipantInfo,
  uniqueParticipantName,
} from "../session/participants.js";
import { TWOWAY_DEFAULTS } from "../session/twoway.js";

export type JoinFailure =
  | "CLOSED"
  | "WRONG_MODE"
  | "INVALID_NAME"
  | "SESSION_FULL";

export type JoinResult =
  | { ok: true; participant: Participant; credential: string }
  | { ok: false; reason: JoinFailure };

export class ParticipantService {
  constructor(
    private readonly store: SessionStore,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  private get maxParticipants(): number {
    return this.config.twowayMaxParticipants ?? TWOWAY_DEFAULTS.maxParticipants;
  }

  join(session: Session, rawName: string, device: DeviceKind): JoinResult {
    if (session.state === "CLOSED") {
      return { ok: false, reason: "CLOSED" };
    }
    if (sessionMode(session) !== "twoway") {
      return { ok: false, reason: "WRONG_MODE" };
    }

    const normalized = normalizeParticipantName(rawName);
    if (!normalized) {
      return { ok: false, reason: "INVALID_NAME" };
    }

    const participants = session.participants ?? [];
    if (participants.length >= this.maxParticipants) {
      return { ok: false, reason: "SESSION_FULL" };
    }

    const credential = generateSecret();
    const participant: Participant = {
      id: randomUUID(),
      name: uniqueParticipantName(participants, normalized),
      device,
      credentialHash: hashToken(credential),
      joinedAt: new Date(this.clock.now()).toISOString(),
    };

    session.participants = participants;
    session.participants.push(participant);
    session.lastActivity = new Date(this.clock.now()).toISOString();
    this.store.update(session);

    return { ok: true, participant, credential };
  }

  authenticate(session: Session, secret: string): Participant | null {
    for (const participant of session.participants ?? []) {
      if (verifyHash(secret, participant.credentialHash)) return participant;
    }
    return null;
  }

  /** Explicit guest leave: remove the member (twoway) or their credential (oneway). */
  leave(session: Session, participant: Participant): boolean {
    const participants = session.participants ?? [];
    const index = participants.findIndex((member) => member.id === participant.id);
    if (index >= 0) {
      participants.splice(index, 1);
      session.participants = participants;
    } else if (sessionMode(session) === "oneway" && participant.device === "phone") {
      session.guestCredentialHash = null;
    } else {
      return false;
    }
    session.lastActivity = new Date(this.clock.now()).toISOString();
    this.store.update(session);
    return true;
  }

  list(session: Session): ParticipantInfo[] {
    return participantsList(session);
  }

  info(participant: Participant): ParticipantInfo {
    return toParticipantInfo(participant);
  }
}
