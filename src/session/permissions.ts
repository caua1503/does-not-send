import type { Participant, Session, SessionFile, SessionMode } from "../types.js";
import { HOST_ACTOR_ID } from "./participants.js";

export function sessionMode(session: Pick<Session, "mode">): SessionMode {
  return session.mode === "twoway" ? "twoway" : "oneway";
}

function isHost(session: Session, participant: Participant): boolean {
  return participant.id === (session.hostId ?? HOST_ACTOR_ID);
}

function isMember(session: Session, participant: Participant): boolean {
  if (isHost(session, participant)) return true;
  return (session.participants ?? []).some((member) => member.id === participant.id);
}

export function canUpload(
  session: Session,
  participant: Participant | null | undefined,
): boolean {
  if (!participant) return false;
  if (sessionMode(session) === "twoway") return isMember(session, participant);
  // Historical oneway behavior: the paired phone uploads, and the host token
  // has always been accepted by the upload route as well.
  return participant.device === "phone" || isHost(session, participant);
}

export function canDownload(
  session: Session,
  participant: Participant | null | undefined,
): boolean {
  if (!participant) return false;
  if (sessionMode(session) === "twoway") return isMember(session, participant);
  return isHost(session, participant);
}

export function canDelete(
  session: Session,
  participant: Participant | null | undefined,
  item: Pick<SessionFile, "senderId">,
): boolean {
  if (!participant) return false;
  if (sessionMode(session) === "oneway") return false;
  if (!isMember(session, participant)) return false;
  return isHost(session, participant) || item.senderId === participant.id;
}

export function canClose(
  session: Session,
  participant: Participant | null | undefined,
): boolean {
  return participant ? isHost(session, participant) : false;
}
