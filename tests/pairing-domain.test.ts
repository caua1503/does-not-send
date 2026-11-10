import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/session/store.js";
import type { Session } from "../src/types.js";

function makeStore(): SessionStore {
  return new SessionStore({ tempDir: "/tmp" });
}

function makeSession(id: string, shortId: string, state: Session["state"] = "WAITING"): Session {
  const now = new Date().toISOString();
  return {
    id,
    computerTokenHash: "comp-hash",
    phoneCredentialHash: null,
    visualId: shortId,
    shortId,
    qrTokenHash: "hash-1",
    activeUploads: 0,
    state,
    createdAt: now,
    lastActivity: now,
    files: [],
    lastSeen: { computer: null, phone: null },
  };
}

describe("pairing domain", () => {
  describe("SessionStore.getByShortId", () => {
    it("finds a session by shortId", () => {
      const store = makeStore();
      store.create(makeSession("sess-1", "K92FA7"));

      const found = store.getByShortId("K92FA7");
      expect(found).toBeDefined();
      expect(found?.id).toBe("sess-1");
      expect(found?.shortId).toBe("K92FA7");
    });

    it("returns undefined when shortId does not exist", () => {
      const store = makeStore();
      store.create(makeSession("sess-1", "ABCDEF"));

      expect(store.getByShortId("NONEXIST")).toBeUndefined();
    });

    it("returns undefined on empty repository", () => {
      const store = makeStore();
      expect(store.getByShortId("A7K92F")).toBeUndefined();
    });

    it("distinguishes among multiple sessions with different shortIds", () => {
      const store = makeStore();
      store.create(makeSession("sess-1", "AAAAAA"));
      store.create(makeSession("sess-2", "BBBBBB", "PAIRED"));

      expect(store.getByShortId("AAAAAA")?.id).toBe("sess-1");
      expect(store.getByShortId("BBBBBB")?.id).toBe("sess-2");
    });

    it("returns undefined after session is deleted", () => {
      const store = makeStore();
      store.create(makeSession("sess-1", "DELETE"));
      expect(store.getByShortId("DELETE")).toBeDefined();

      store.delete("sess-1");
      expect(store.getByShortId("DELETE")).toBeUndefined();
    });
  });
});
