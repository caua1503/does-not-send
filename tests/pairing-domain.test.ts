import { describe, it, expect } from "vitest";
import { generateShortId } from "../src/utils/crypto.js";
import { SessionRepository } from "../src/repositories/session-repository.js";
import type { Session } from "../src/types.js";

describe("pairing domain", () => {
  describe("generateShortId", () => {
    it("generates a 6-character string by default", () => {
      const id = generateShortId();
      expect(typeof id).toBe("string");
      expect(id).toHaveLength(6);
    });

    it("respects custom length parameter", () => {
      expect(generateShortId(4)).toHaveLength(4);
      expect(generateShortId(8)).toHaveLength(8);
      expect(generateShortId(10)).toHaveLength(10);
    });

    it("contains only uppercase alphanumeric characters without ambiguous characters (no 0, O, 1, I)", () => {
      // Unambiguous character set: 2-9, A-Z excluding O and I
      const allowedPattern = /^[2-9A-HJ-NP-Z]+$/;
      const ambiguousPattern = /[01OI]/;

      for (let i = 0; i < 200; i++) {
        const id = generateShortId();
        expect(id).toMatch(allowedPattern);
        expect(id).not.toMatch(ambiguousPattern);
      }
    });

    it("generates unique values across multiple calls", () => {
      const generated = new Set<string>();
      const iterations = 500;
      for (let i = 0; i < iterations; i++) {
        generated.add(generateShortId());
      }
      expect(generated.size).toBe(iterations);
    });
  });

  describe("Session pairing domain attributes", () => {
    it("supports required and optional pairing fields on Session interface", () => {
      const session: Session = {
        id: "sess-1",
        computerTokenHash: "comp-hash",
        phoneCredentialHash: null,
        visualId: "A7K92F",
        shortId: "A7K92F",
        qrTokenHash: "hash-of-qr-token",
        qrConsumedAt: null,
        isPaired: false,
        activeUploads: 0,
        pairedAt: undefined,
        phoneDisconnectedAt: undefined,
        state: "WAITING",
        createdAt: "2026-10-30T12:00:00.000Z",
        lastActivity: "2026-10-30T12:00:00.000Z",
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };

      expect(session.shortId).toBe("A7K92F");
      expect(session.qrTokenHash).toBe("hash-of-qr-token");
      expect(session.qrConsumedAt).toBeNull();
      expect(session.isPaired).toBe(false);
      expect(session.pairedAt).toBeUndefined();
      expect(session.phoneDisconnectedAt).toBeUndefined();

      // Paired state simulation
      const pairedSession: Session = {
        ...session,
        qrConsumedAt: "2026-10-30T12:01:00.000Z",
        isPaired: true,
        state: "PAIRED",
        pairedAt: "2026-10-30T12:01:00.000Z",
        phoneDisconnectedAt: "2026-10-30T12:05:00.000Z",
      };

      expect(pairedSession.qrConsumedAt).toBe("2026-10-30T12:01:00.000Z");
      expect(pairedSession.isPaired).toBe(true);
      expect(pairedSession.state).toBe("PAIRED");
      expect(pairedSession.pairedAt).toBe("2026-10-30T12:01:00.000Z");
      expect(pairedSession.phoneDisconnectedAt).toBe("2026-10-30T12:05:00.000Z");
    });
  });

  describe("SessionRepository.getByShortId", () => {
    it("finds a session by shortId", () => {
      const repo = new SessionRepository();
      const session: Session = {
        id: "sess-1",
        computerTokenHash: "comp-hash",
        phoneCredentialHash: null,
        visualId: "K92FA7",
        shortId: "K92FA7",
        qrTokenHash: "hash-1",
        qrConsumedAt: null,
        isPaired: false,
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };

      repo.create(session);

      const found = repo.getByShortId("K92FA7");
      expect(found).toBeDefined();
      expect(found?.id).toBe("sess-1");
      expect(found?.shortId).toBe("K92FA7");
    });

    it("returns undefined when shortId does not exist", () => {
      const repo = new SessionRepository();
      const session: Session = {
        id: "sess-1",
        computerTokenHash: "comp-hash",
        phoneCredentialHash: null,
        visualId: "ABCDEF",
        shortId: "ABCDEF",
        qrTokenHash: "hash-1",
        qrConsumedAt: null,
        isPaired: false,
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };

      repo.create(session);

      expect(repo.getByShortId("NONEXIST")).toBeUndefined();
    });

    it("returns undefined on empty repository", () => {
      const repo = new SessionRepository();
      expect(repo.getByShortId("A7K92F")).toBeUndefined();
    });

    it("distinguishes among multiple sessions with different shortIds", () => {
      const repo = new SessionRepository();
      const s1: Session = {
        id: "sess-1",
        computerTokenHash: "comp-hash-1",
        phoneCredentialHash: null,
        visualId: "AAAAAA",
        shortId: "AAAAAA",
        qrTokenHash: "hash-1",
        qrConsumedAt: null,
        isPaired: false,
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };
      const s2: Session = {
        id: "sess-2",
        computerTokenHash: "comp-hash-2",
        phoneCredentialHash: null,
        visualId: "BBBBBB",
        shortId: "BBBBBB",
        qrTokenHash: "hash-2",
        qrConsumedAt: "2026-10-30T12:01:00.000Z",
        isPaired: true,
        activeUploads: 0,
        state: "PAIRED",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };

      repo.create(s1);
      repo.create(s2);

      expect(repo.getByShortId("AAAAAA")?.id).toBe("sess-1");
      expect(repo.getByShortId("BBBBBB")?.id).toBe("sess-2");
    });

    it("returns undefined after session is deleted", () => {
      const repo = new SessionRepository();
      const session: Session = {
        id: "sess-1",
        computerTokenHash: "comp-hash-1",
        phoneCredentialHash: null,
        visualId: "DELETE",
        shortId: "DELETE",
        qrTokenHash: "hash-1",
        qrConsumedAt: null,
        isPaired: false,
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
        phoneLostAt: null,
        computerLostAt: null,
      };

      repo.create(session);
      expect(repo.getByShortId("DELETE")).toBeDefined();

      repo.delete("sess-1");
      expect(repo.getByShortId("DELETE")).toBeUndefined();
    });
  });
});
