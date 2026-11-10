import { describe, it, expect } from "vitest";
import { SessionRepository } from "../src/repositories/session-repository.js";
import type { Session } from "../src/types.js";

describe("pairing domain", () => {
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
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
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
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
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
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
      };
      const s2: Session = {
        id: "sess-2",
        computerTokenHash: "comp-hash-2",
        phoneCredentialHash: null,
        visualId: "BBBBBB",
        shortId: "BBBBBB",
        qrTokenHash: "hash-2",
        activeUploads: 0,
        state: "PAIRED",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
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
        activeUploads: 0,
        state: "WAITING",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        files: [],
        lastSeen: { computer: null, phone: null },
      };

      repo.create(session);
      expect(repo.getByShortId("DELETE")).toBeDefined();

      repo.delete("sess-1");
      expect(repo.getByShortId("DELETE")).toBeUndefined();
    });
  });
});
