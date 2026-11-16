import { describe, expect, it } from "vitest";
import type { Participant, Session, SessionFile } from "../src/types.js";
import {
  canClose,
  canDelete,
  canDownload,
  canUpload,
} from "../src/session/permissions.js";
import { guestActor, hostActor } from "../src/session/participants.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    hostTokenHash: "host-hash",
    guestCredentialHash: "guest-hash",
    visualId: "ABCDEF",
    shortId: "ABCDEF",
    qrTokenHash: "qr-hash",
    state: "PAIRED",
    activeUploads: 0,
    createdAt: new Date(0).toISOString(),
    lastActivity: new Date(0).toISOString(),
    files: [],
    lastSeen: { host: null, guest: null },
    closedReason: null,
    ...overrides,
  };
}

function makeParticipant(id: string, device: "phone" | "desktop"): Participant {
  return {
    id,
    name: id,
    device,
    credentialHash: `hash-${id}`,
    joinedAt: new Date(0).toISOString(),
  };
}

function makeFile(overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    id: "file-1",
    originalName: "file.txt",
    storageName: "file-1",
    mimeType: "text/plain",
    size: 1,
    bytesReceived: 1,
    state: "completed",
    createdAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    version: 1,
    extension: "txt",
    category: "documents",
    ...overrides,
  };
}

describe("permissões oneway (modo padrão)", () => {
  const session = makeSession();
  const host = hostActor(session);
  const guest = guestActor();

  it("trata sessão sem mode como oneway", () => {
    // Host no oneway é o ator sintético; o convidado é apenas o telefone.
    expect(canUpload(session, guest)).toBe(true);
    expect(canDownload(session, guest)).toBe(false);
    expect(canDelete(session, guest, makeFile())).toBe(false);
    expect(canClose(session, guest)).toBe(false);
  });

  it("host do oneway mantém o comportamento atual de envio, download e encerramento", () => {
    expect(canUpload(session, host)).toBe(true);
    expect(canDownload(session, host)).toBe(true);
    expect(canDelete(session, host, makeFile())).toBe(false);
    expect(canClose(session, host)).toBe(true);
  });
});

describe("permissões twoway", () => {
  const host = makeParticipant("host-1", "desktop");
  const ana = makeParticipant("ana", "phone");
  const bruno = makeParticipant("bruno", "desktop");
  const session = makeSession({
    mode: "twoway",
    hostId: host.id,
    participants: [host, ana, bruno],
  });

  it("todos os participantes enviam e baixam", () => {
    for (const participant of [host, ana, bruno]) {
      expect(canUpload(session, participant)).toBe(true);
      expect(canDownload(session, participant)).toBe(true);
    }
  });

  it("só o autor ou o anfitrião apaga", () => {
    const anaFile = makeFile({ senderId: ana.id });

    expect(canDelete(session, ana, anaFile)).toBe(true);
    expect(canDelete(session, host, anaFile)).toBe(true);
    expect(canDelete(session, bruno, anaFile)).toBe(false);
  });

  it("arquivo sem autor só pode ser apagado pelo anfitrião", () => {
    const legacyFile = makeFile();

    expect(canDelete(session, host, legacyFile)).toBe(true);
    expect(canDelete(session, ana, legacyFile)).toBe(false);
  });

  it("só o anfitrião encerra", () => {
    expect(canClose(session, host)).toBe(true);
    expect(canClose(session, ana)).toBe(false);
    expect(canClose(session, bruno)).toBe(false);
  });

  it("estranho fora da sessão não envia, baixa, apaga nem encerra", () => {
    const stranger = makeParticipant("stranger", "phone");

    expect(canUpload(session, stranger)).toBe(false);
    expect(canDownload(session, stranger)).toBe(false);
    expect(canDelete(session, stranger, makeFile({ senderId: "stranger" }))).toBe(false);
    expect(canClose(session, stranger)).toBe(false);
  });

  it("anfitrião é reconhecido pelo hostId mesmo com a lista de participantes vazia", () => {
    const empty = makeSession({ mode: "twoway", hostId: host.id, participants: [] });

    expect(canUpload(empty, host)).toBe(true);
    expect(canDownload(empty, host)).toBe(true);
    expect(canClose(empty, host)).toBe(true);
  });
});
