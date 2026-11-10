import { describe, it, expect } from "vitest";
import {
  consumePairing,
  generateQrToken,
  hashToken,
} from "../src/session/pairing.js";
import type { PairableSession } from "../src/session/pairing.js";

function makeSession(overrides: Partial<PairableSession> = {}): PairableSession {
  const raw = generateQrToken();
  return {
    id: "sess-test",
    state: "WAITING",
    qrTokenHash: hashToken(raw),
    pairedAt: null,
    ...overrides,
  };
}

describe("consumePairing", () => {
  it("primeiro pareamento bem-sucedido muda WAITING para PAIRED", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const result = consumePairing(session, raw);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.pairedAt).toBe("string");
    }
    expect(session.state).toBe("PAIRED");
    expect(session.pairedAt).not.toBeNull();
  });

  it("pareamento devolve phoneCredential e ela nunca é armazenada pura", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const result = consumePairing(session, raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.phoneCredential).toBe("string");
      expect(result.phoneCredential.length).toBeGreaterThanOrEqual(40);
      expect(JSON.stringify(session)).not.toContain(result.phoneCredential);
      expect((session as any).phoneCredentialHash).toBe(hashToken(result.phoneCredential));
    }
  });

  it("o mesmo QR pode ser lido várias vezes; a nova leitura substitui a credencial", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const first = consumePairing(session, raw);
    expect(first.ok).toBe(true);

    const second = consumePairing(session, raw);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.phoneCredential).not.toBe(first.phoneCredential);
      expect(session.phoneCredentialHash).toBe(hashToken(second.phoneCredential));
    }
    expect(session.state).toBe("PAIRED");
  });

  it("QR continua válido em sessão PAIRED e DISCONNECTED", () => {
    const raw = generateQrToken();

    for (const state of ["PAIRED", "DISCONNECTED"] as const) {
      const session = makeSession({ qrTokenHash: hashToken(raw), state });
      const result = consumePairing(session, raw);
      expect(result.ok).toBe(true);
      expect(session.state).toBe(state);
    }
  });

  it("token errado não consome o QR", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const result = consumePairing(session, "wrong-token-value");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID");
    }
    expect(session.state).toBe("WAITING");
    expect(session.pairedAt).toBeNull();
  });

  it("retorna NOT_FOUND quando sessão não existe", () => {
    const result = consumePairing(undefined, "some-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("retorna CLOSED quando sessão está fechada", () => {
    const raw = generateQrToken();
    const session = makeSession({
      qrTokenHash: hashToken(raw),
      state: "CLOSED",
    });

    const result = consumePairing(session, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLOSED");
    }
  });

  it("concorrência: 20 leituras simultâneas do mesmo QR todas têm sucesso", async () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => consumePairing(session, raw)),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(20);
  });

  it("sessões isoladas: consumir o QR da sessão A não afeta a B", () => {
    const rawA = generateQrToken();
    const rawB = generateQrToken();
    const sessionA = makeSession({ id: "sess-a", qrTokenHash: hashToken(rawA) });
    const sessionB = makeSession({ id: "sess-b", qrTokenHash: hashToken(rawB) });

    const resA = consumePairing(sessionA, rawA);
    expect(resA.ok).toBe(true);
    expect(sessionA.state).toBe("PAIRED");

    expect(sessionB.state).toBe("WAITING");
    expect(sessionB.pairedAt).toBeNull();

    const resB = consumePairing(sessionB, rawB);
    expect(resB.ok).toBe(true);
    expect(sessionB.state).toBe("PAIRED");
  });

  it("consumir o QR NÃO encerra a sessão", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    consumePairing(session, raw);
    expect(session.state).toBe("PAIRED");
    expect(session.state).not.toBe("CLOSED");
  });
});
