import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHATS_NEW_STORAGE_KEY,
  consumeWhatsNewView,
  type WhatsNewConfig,
} from "../../lib/whatsNew.ts";

const config: WhatsNewConfig = {
  enabled: true,
  maxViews: 3,
  updateId: "1.2",
  items: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("consumeWhatsNewView", () => {
  it("exibe no máximo maxViews vezes por updateId", () => {
    expect(consumeWhatsNewView(config)).toBe(true);
    expect(consumeWhatsNewView(config)).toBe(true);
    expect(consumeWhatsNewView(config)).toBe(true);
    expect(consumeWhatsNewView(config)).toBe(false);

    const state = JSON.parse(localStorage.getItem(WHATS_NEW_STORAGE_KEY)!);
    expect(state.viewCount).toBe(3);
  });

  it("reinicia a contagem quando o updateId muda", () => {
    consumeWhatsNewView(config);
    consumeWhatsNewView(config);
    consumeWhatsNewView(config);
    expect(consumeWhatsNewView(config)).toBe(false);

    expect(consumeWhatsNewView({ ...config, updateId: "2026-11-a" })).toBe(true);

    const state = JSON.parse(localStorage.getItem(WHATS_NEW_STORAGE_KEY)!);
    expect(state).toMatchObject({ updateId: "2026-11-a", viewCount: 1 });
  });

  it("não exibe nem quebra quando a persistência falha", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(consumeWhatsNewView(config)).toBe(false);
  });

  it("respeita enabled: false", () => {
    expect(consumeWhatsNewView({ ...config, enabled: false })).toBe(false);
    expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBeNull();
  });
});
