import { beforeEach, describe, expect, it } from "vitest";
import {
  canCloseSession,
  canDeleteItem,
  canDownloadItem,
  initialTwowayState,
  itemToFileEntry,
  twowayReducer,
  type TwowayItem,
} from "../../lib/twowayReducer.ts";
import {
  clearTwowaySession,
  readTwowaySession,
  writeTwowaySession,
} from "../../lib/twowaySessionStorage.ts";

const ana = { id: "ana", name: "Ana", device: "phone" as const };
const host = { id: "host", name: "Host", device: "desktop" as const };

function item(overrides: Partial<TwowayItem> = {}): TwowayItem {
  return {
    id: "item-1",
    kind: "file",
    name: "a.txt",
    size: 3,
    senderId: ana.id,
    senderName: ana.name,
    origin: ana.device,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("twowayReducer", () => {
  it("monta a lista inicial e atualiza participantes em tempo real", () => {
    let state = twowayReducer(initialTwowayState, {
      type: "participants:list",
      participants: [host, ana],
    });
    state = twowayReducer(state, {
      type: "participant:joined",
      id: "bruno",
      name: "Bruno",
      device: "desktop",
    });
    state = twowayReducer(state, { type: "participant:left", id: ana.id });

    expect(state.participants.map((participant) => participant.name)).toEqual([
      "Host",
      "Bruno",
    ]);
  });

  it("adiciona item uma vez e remove pelo id", () => {
    let state = twowayReducer(initialTwowayState, {
      type: "item:added",
      ...item(),
    });
    state = twowayReducer(state, { type: "item:added", ...item() });

    expect(state.items).toHaveLength(1);

    state = twowayReducer(state, { type: "item:deleted", id: "item-1" });
    expect(state.items).toHaveLength(0);
  });

  it("substitui itens locais após reconexão, inclusive exclusões perdidas", () => {
    const live = item({ id: "live" });
    const history = item({ id: "history", version: 4 });
    let state = twowayReducer(initialTwowayState, { type: "item:added", ...live });
    state = twowayReducer(state, { type: "items:snapshot", items: [history] });

    expect(state.items.map((entry) => entry.id)).toEqual(["history"]);
    expect(itemToFileEntry(state.items[0]!).version).toBe(4);
  });

  it("session:closed limpa itens e participantes", () => {
    let state = twowayReducer(initialTwowayState, {
      type: "participants:list",
      participants: [host, ana],
    });
    state = twowayReducer(state, { type: "item:added", ...item() });

    expect(twowayReducer(state, { type: "session:closed" })).toEqual(initialTwowayState);
  });
});

describe("visibilidade twoway", () => {
  it("todos baixam qualquer item", () => {
    expect(canDownloadItem(item(), { participantId: "bruno", isHost: false })).toBe(true);
    expect(canDownloadItem(item(), { participantId: host.id, isHost: true })).toBe(true);
  });

  it("apagar só aparece no próprio item ou para o anfitrião", () => {
    expect(canDeleteItem(item(), { participantId: ana.id, isHost: false })).toBe(true);
    expect(canDeleteItem(item(), { participantId: "bruno", isHost: false })).toBe(false);
    expect(canDeleteItem(item(), { participantId: host.id, isHost: true })).toBe(true);
  });

  it("só o anfitrião encerra", () => {
    expect(canCloseSession({ participantId: host.id, isHost: true })).toBe(true);
    expect(canCloseSession({ participantId: ana.id, isHost: false })).toBe(false);
  });
});

describe("twowaySessionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("guarda e lê o participante da sessão", () => {
    writeTwowaySession("s1", ana, host.id, "ABC123");

    expect(readTwowaySession("s1")).toEqual({
      participant: ana,
      hostId: host.id,
      visualId: "ABC123",
    });

    clearTwowaySession("s1");
    expect(readTwowaySession("s1")).toBeNull();
  });

  it("ignora JSON inválido", () => {
    localStorage.setItem("dns_twoway_participant_s2", "{broken");
    expect(readTwowaySession("s2")).toBeNull();
  });
});
