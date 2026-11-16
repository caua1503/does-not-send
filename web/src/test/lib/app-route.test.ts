import { describe, it, expect } from "vitest";
import { isInvitePath, isJoinPath } from "../../App.tsx";

describe("join route aliases", () => {
  it("aceita a rota nova e a antiga usada por QRs já emitidos", () => {
    expect(isJoinPath("/entrar/session-1")).toBe(true);
    expect(isJoinPath("/enviar/session-1")).toBe(true);
    expect(isJoinPath("/")).toBe(false);
  });

  it("separa convites de QR", () => {
    expect(isInvitePath("/i/abc12345")).toBe(true);
    expect(isInvitePath("/entrar/session-1")).toBe(false);
    expect(isInvitePath("/enviar/session-1")).toBe(false);
    expect(isInvitePath("/")).toBe(false);
  });
});
