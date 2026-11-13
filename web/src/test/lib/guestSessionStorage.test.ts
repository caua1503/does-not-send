import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGuestSession,
  readGuestSession,
  writeGuestSession,
} from "../../lib/guestSessionStorage.ts";

describe("guestSessionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migra a chave antiga e o shape phoneCredential na primeira leitura", () => {
    localStorage.setItem(
      "dns_phone_cred_s1",
      JSON.stringify({ phoneCredential: "legacy-cred", visualId: "AB12" }),
    );

    expect(readGuestSession("s1")).toEqual({ credential: "legacy-cred", visualId: "AB12" });
    expect(localStorage.getItem("dns_phone_cred_s1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("dns_guest_cred_s1")!)).toEqual({
      guestCredential: "legacy-cred",
      visualId: "AB12",
    });
  });

  it("migra valor antigo salvo como string pura", () => {
    localStorage.setItem("dns_phone_cred_s2", "raw-cred");

    expect(readGuestSession("s2")).toEqual({ credential: "raw-cred", visualId: null });
    expect(localStorage.getItem("dns_phone_cred_s2")).toBeNull();
  });

  it("prefere a chave nova e remove a antiga", () => {
    localStorage.setItem("dns_guest_cred_s3", JSON.stringify({ guestCredential: "new-cred" }));
    localStorage.setItem("dns_phone_cred_s3", JSON.stringify({ phoneCredential: "old-cred" }));

    expect(readGuestSession("s3").credential).toBe("new-cred");
    expect(localStorage.getItem("dns_phone_cred_s3")).toBeNull();
  });

  it("não descarta credencial antiga válida quando a chave nova está vazia", () => {
    localStorage.setItem("dns_guest_cred_s5", "{}");
    localStorage.setItem(
      "dns_phone_cred_s5",
      JSON.stringify({ phoneCredential: "legacy-cred" }),
    );

    expect(readGuestSession("s5").credential).toBe("legacy-cred");
    expect(JSON.parse(localStorage.getItem("dns_guest_cred_s5")!)).toMatchObject({
      guestCredential: "legacy-cred",
    });
    expect(localStorage.getItem("dns_phone_cred_s5")).toBeNull();
  });

  it("não grava credencial nula quando não há nada para migrar", () => {
    localStorage.setItem("dns_phone_cred_s6", "{}");

    expect(readGuestSession("s6")).toEqual({ credential: null, visualId: null });
    expect(localStorage.getItem("dns_guest_cred_s6")).toBeNull();
    expect(localStorage.getItem("dns_phone_cred_s6")).toBeNull();
  });

  it("grava no shape novo e limpa as duas chaves", () => {
    localStorage.setItem("dns_phone_cred_s4", JSON.stringify({ phoneCredential: "old-cred" }));
    writeGuestSession("s4", "new-cred", "CD34");

    expect(JSON.parse(localStorage.getItem("dns_guest_cred_s4")!)).toEqual({
      guestCredential: "new-cred",
      visualId: "CD34",
    });
    expect(localStorage.getItem("dns_phone_cred_s4")).toBeNull();

    clearGuestSession("s4");
    expect(localStorage.getItem("dns_guest_cred_s4")).toBeNull();
    expect(localStorage.getItem("dns_phone_cred_s4")).toBeNull();
  });
});
