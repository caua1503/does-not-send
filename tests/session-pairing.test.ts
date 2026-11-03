import { describe, it, expect } from "vitest";
import {
  consumePairing,
  generateQrToken,
  hashToken,
} from "../src/session/pairing.js";
import type { PairableSession } from "../src/session/pairing.js";
import { PairingError } from "../src/session/errors.js";

function makeSession(overrides: Partial<PairableSession> = {}): PairableSession {
  const raw = generateQrToken();
  return {
    id: "sess-test",
    state: "WAITING",
    qrTokenHash: hashToken(raw),
    qrConsumedAt: null,
    pairedAt: null,
    ...overrides,
  };
}

describe("hashToken", () => {
  it("returns 64-char hex string (SHA-256)", () => {
    const hash = hashToken("abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input produces same hash", () => {
    expect(hashToken("test-token")).toBe(hashToken("test-token"));
  });

  it("different inputs produce different hashes", () => {
    expect(hashToken("token-1")).not.toBe(hashToken("token-2"));
  });
});

describe("generateQrToken", () => {
  it("generates base64url string with sufficient entropy", () => {
    const t1 = generateQrToken();
    const t2 = generateQrToken();
    expect(typeof t1).toBe("string");
    expect(t1.length).toBeGreaterThanOrEqual(40);
    expect(t1).not.toBe(t2);
  });
});

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
    expect(session.qrConsumedAt).not.toBeNull();
    expect(session.pairedAt).not.toBeNull();
  });

  it("segundo telefone com o mesmo QR é recusado (ALREADY_CONSUMED)", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const first = consumePairing(session, raw);
    expect(first.ok).toBe(true);

    const second = consumePairing(session, raw);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(PairingError);
      expect(second.error.code).toBe("ALREADY_CONSUMED");
    }
  });

  it("QR consumido não pode ser reutilizado, mesmo com token correto", () => {
    const raw = generateQrToken();
    const session = makeSession({
      qrTokenHash: hashToken(raw),
      qrConsumedAt: new Date().toISOString(),
      state: "PAIRED",
    });

    const result = consumePairing(session, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ALREADY_CONSUMED");
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
    expect(session.qrConsumedAt).toBeNull();
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

  it("concorrência: Promise.all com 20 chamadas de consumePairing, exatamente 1 sucesso", async () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => consumePairing(session, raw)),
      ),
    );

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);
    for (const f of failures) {
      if (!f.ok) {
        expect(f.error.code).toBe("ALREADY_CONSUMED");
      }
    }
  });

  it("sessões isoladas: consumir o QR da sessão A não afeta a B", () => {
    const rawA = generateQrToken();
    const rawB = generateQrToken();
    const sessionA = makeSession({ id: "sess-a", qrTokenHash: hashToken(rawA) });
    const sessionB = makeSession({ id: "sess-b", qrTokenHash: hashToken(rawB) });

    const resA = consumePairing(sessionA, rawA);
    expect(resA.ok).toBe(true);
    expect(sessionA.state).toBe("PAIRED");
    expect(sessionA.qrConsumedAt).not.toBeNull();

    expect(sessionB.state).toBe("WAITING");
    expect(sessionB.qrConsumedAt).toBeNull();
    expect(sessionB.pairedAt).toBeNull();

    const resB = consumePairing(sessionB, rawB);
    expect(resB.ok).toBe(true);
    expect(sessionB.state).toBe("PAIRED");
  });

  it("hash do qrToken é o que fica armazenado (token puro não aparece no objeto da sessão)", () => {
    const raw = generateQrToken();
    const hash = hashToken(raw);
    const session = makeSession({ qrTokenHash: hash });

    expect(session.qrTokenHash).toBe(hash);
    expect(session.qrTokenHash).not.toBe(raw);

    const res = consumePairing(session, raw);
    expect(res.ok).toBe(true);

    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(raw);
    expect(serialized).toContain(hash);
  });

  it("consumir o QR NÃO encerra a sessão", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });

    consumePairing(session, raw);
    expect(session.state).toBe("PAIRED");
    expect(session.state).not.toBe("CLOSED");
  });
});
