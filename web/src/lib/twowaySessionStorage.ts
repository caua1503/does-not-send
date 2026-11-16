import type { ParticipantInfo } from "./api.ts";

const KEY_PREFIX = "dns_twoway_participant_";

export interface StoredTwowaySession {
  participant: ParticipantInfo;
  hostId: string | null;
  visualId: string | null;
}

function isParticipant(value: unknown): value is ParticipantInfo {
  if (!value || typeof value !== "object") return false;
  const participant = value as Record<string, unknown>;
  return (
    typeof participant.id === "string" &&
    typeof participant.name === "string" &&
    (participant.device === "phone" || participant.device === "desktop")
  );
}

export function readTwowaySession(id: string): StoredTwowaySession | null {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isParticipant(parsed.participant)) return null;
    return {
      participant: parsed.participant,
      hostId: typeof parsed.hostId === "string" ? parsed.hostId : null,
      visualId: typeof parsed.visualId === "string" ? parsed.visualId : null,
    };
  } catch {
    return null;
  }
}

export function writeTwowaySession(
  id: string,
  participant: ParticipantInfo,
  hostId?: string | null,
  visualId?: string | null,
): void {
  if (!id) return;
  try {
    localStorage.setItem(
      `${KEY_PREFIX}${id}`,
      JSON.stringify({ participant, hostId: hostId ?? null, visualId: visualId ?? null }),
    );
  } catch {}
}

export function clearTwowaySession(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(`${KEY_PREFIX}${id}`);
  } catch {}
}
