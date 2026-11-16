import { randomUUID } from "node:crypto";
import type { DeviceKind, Participant, ParticipantInfo, Session } from "../types.js";

export const HOST_ACTOR_ID = "__host__";
export const GUEST_ACTOR_ID = "__guest__";
export const PARTICIPANT_NAME_MAX_LENGTH = 40;
export const DEFAULT_HOST_NAME = "Anfitrião";
export const DEFAULT_GUEST_NAME = "Celular";

/** Trims, removes HTML tags/angle brackets and control characters, caps length. */
export function normalizeParticipantName(raw: string): string | null {
  const withoutTags = raw.replace(/<[^>]*>/g, " ");
  const cleaned = withoutTags
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return null;
  return cleaned.slice(0, PARTICIPANT_NAME_MAX_LENGTH).trim();
}

/** "Ana", "Ana", "Ana" → "Ana", "Ana (2)", "Ana (3)". */
export function uniqueParticipantName(
  participants: readonly Participant[],
  desired: string,
): string {
  const used = new Set(participants.map((participant) => participant.name.toLowerCase()));
  if (!used.has(desired.toLowerCase())) return desired;

  let counter = 2;
  while (used.has(`${desired} (${counter})`.toLowerCase())) counter++;
  return `${desired} (${counter})`;
}

export function createHostParticipant(
  name: string | undefined,
  device: DeviceKind | undefined,
  joinedAt: string,
): Participant {
  return {
    id: randomUUID(),
    name: (name ? normalizeParticipantName(name) : null) ?? DEFAULT_HOST_NAME,
    device: device ?? "desktop",
    credentialHash: "",
    joinedAt,
  };
}

/** Actor used when the request was authenticated by the host token. */
export function hostActor(session: Session): Participant {
  const host =
    session.participants?.find((participant) => participant.id === session.hostId) ??
    session.participants?.find((participant) => participant.device === "desktop");

  if (host) return host;

  return {
    id: session.hostId ?? HOST_ACTOR_ID,
    name: DEFAULT_HOST_NAME,
    device: "desktop",
    credentialHash: "",
    joinedAt: session.createdAt,
  };
}

/** Actor used when a oneway session was authenticated by the phone credential. */
export function guestActor(): Participant {
  return {
    id: GUEST_ACTOR_ID,
    name: DEFAULT_GUEST_NAME,
    device: "phone",
    credentialHash: "",
    joinedAt: "",
  };
}

export function toParticipantInfo(participant: Participant): ParticipantInfo {
  return {
    id: participant.id,
    name: participant.name,
    device: participant.device,
  };
}

export function participantsList(session: Session): ParticipantInfo[] {
  return (session.participants ?? []).map(toParticipantInfo);
}
