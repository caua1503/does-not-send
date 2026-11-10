import { describe, it, expect } from "vitest";
import {
  authorize,
  generateSecret,
  startUpload,
  endUpload,
  type AuthorizableSession,
} from "../src/session/auth.js";
import { hashToken } from "../src/session/pairing.js";

function makeAuthSession(overrides: Partial<AuthorizableSession> = {}): AuthorizableSession {
  const computerSecret = generateSecret();
  const phoneSecret = generateSecret();
  return {
    id: "sess-1",
    state: "PAIRED",
    computerTokenHash: hashToken(computerSecret),
    phoneCredentialHash: hashToken(phoneSecret),
    activeUploads: 0,
    ...overrides,
  };
}

describe("authorize", () => {
  it("autoriza computador com computerToken correto", () => {
    const rawComputer = generateSecret();
    const session = makeAuthSession({ computerTokenHash: hashToken(rawComputer) });

    const auth = authorize(session, "computer", rawComputer);
    expect(auth.ok).toBe(true);
  });

  it("recusa computador com token errado (INVALID)", () => {
    const session = makeAuthSession();
    const auth = authorize(session, "computer", "wrong-secret");
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe("INVALID");
    }
  });

  it("autoriza telefone com phoneCredential correta quando sessão está PAIRED", () => {
    const rawPhone = generateSecret();
    const session = makeAuthSession({
      state: "PAIRED",
      phoneCredentialHash: hashToken(rawPhone),
    });

    const auth = authorize(session, "phone", rawPhone);
    expect(auth.ok).toBe(true);
  });

  it("recusa telefone com credencial de outra sessão (INVALID)", () => {
    const session1 = makeAuthSession();
    const session2 = makeAuthSession();
    const rawPhone1 = generateSecret();
    session1.phoneCredentialHash = hashToken(rawPhone1);

    const auth = authorize(session2, "phone", rawPhone1);
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe("INVALID");
    }
  });

  it("recusa telefone quando sessão ainda não foi pareada (phoneCredentialHash null)", () => {
    const session = makeAuthSession({
      state: "WAITING",
      phoneCredentialHash: null,
    });

    const auth = authorize(session, "phone", generateSecret());
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe("INVALID");
    }
  });

  it("recusa quando sessão está CLOSED (CLOSED)", () => {
    const rawComputer = generateSecret();
    const rawPhone = generateSecret();
    const session = makeAuthSession({
      state: "CLOSED",
      computerTokenHash: hashToken(rawComputer),
      phoneCredentialHash: hashToken(rawPhone),
    });

    const authComp = authorize(session, "computer", rawComputer);
    expect(authComp.ok).toBe(false);
    if (!authComp.ok) expect(authComp.reason).toBe("CLOSED");

    const authPhone = authorize(session, "phone", rawPhone);
    expect(authPhone.ok).toBe(false);
    if (!authPhone.ok) expect(authPhone.reason).toBe("CLOSED");
  });

  it("recusa quando sessão não existe (NOT_FOUND)", () => {
    const auth = authorize(undefined, "computer", "any");
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.reason).toBe("NOT_FOUND");
  });
});

describe("contador de uploads e transições PAIRED <-> TRANSFERRING", () => {
  it("contador de uploads: PAIRED vira TRANSFERRING no primeiro upload e volta a PAIRED ao terminar", () => {
    const session = makeAuthSession({ state: "PAIRED", activeUploads: 0 });

    // Primeiro upload inicia
    startUpload(session);
    expect(session.state).toBe("TRANSFERRING");
    expect(session.activeUploads).toBe(1);

    // Segundo upload simultâneo
    startUpload(session);
    expect(session.state).toBe("TRANSFERRING");
    expect(session.activeUploads).toBe(2);

    // Primeiro upload termina: ainda há 1 ativo, continua TRANSFERRING
    endUpload(session);
    expect(session.state).toBe("TRANSFERRING");
    expect(session.activeUploads).toBe(1);

    // Segundo upload termina: activeUploads zera, volta para PAIRED
    endUpload(session);
    expect(session.state).toBe("PAIRED");
    expect(session.activeUploads).toBe(0);
  });

  it("lança erro ao iniciar upload se estado não for PAIRED nem TRANSFERRING", () => {
    const session = makeAuthSession({ state: "WAITING", activeUploads: 0 });
    expect(() => startUpload(session)).toThrow(/invalid/i);
  });
});
