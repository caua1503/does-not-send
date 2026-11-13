import { describe, it, expect } from "vitest";
import { isJoinPath } from "../../App.tsx";

describe("join route aliases", () => {
  it("aceita a rota nova e a antiga usada por QRs já emitidos", () => {
    expect(isJoinPath("/entrar/session-1")).toBe(true);
    expect(isJoinPath("/enviar/session-1")).toBe(true);
    expect(isJoinPath("/")).toBe(false);
  });
});
