import { afterEach, describe, expect, it } from "vitest";
import { resolveAdminConfig } from "../src/utils/config.js";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function resolve(env: Record<string, string | undefined>) {
  return resolveAdminConfig(env as NodeJS.ProcessEnv);
}

describe("resolveAdminConfig (regra de produção)", () => {
  it("em produção sem senha, com 'admin' ou curta, o painel não existe", () => {
    // Que bug pega: /admin exposto em produção com a senha padrão ou fraca.
    expect(resolve({ NODE_ENV: "production" })).toBeUndefined();
    expect(resolve({ NODE_ENV: "production", ADMIN_PASSWORD: "admin" })).toBeUndefined();
    expect(resolve({ NODE_ENV: "production", ADMIN_PASSWORD: "curta12345" })).toBeUndefined();
  });

  it("em produção aceita senha com 12+ caracteres (e rejeita exatamente 11)", () => {
    expect(resolve({ NODE_ENV: "production", ADMIN_PASSWORD: "12345678901" })).toBeUndefined();
    const ok = resolve({ NODE_ENV: "production", ADMIN_PASSWORD: "123456789012" });
    expect(ok).toMatchObject({ user: "admin", password: "123456789012" });
  });

  it("fora de produção cai para admin/admin sem senha e respeita ADMIN_USER", () => {
    expect(resolve({})).toMatchObject({ user: "admin", password: "admin" });
    expect(resolve({ NODE_ENV: "test" })).toMatchObject({ user: "admin", password: "admin" });
    expect(resolve({ ADMIN_USER: "gestor", ADMIN_PASSWORD: "x" })).toMatchObject({
      user: "gestor",
      password: "x",
    });
  });

  it("ADMIN_TZ padrão America/Sao_Paulo e fuso inválido vira UTC (não derruba o boot)", () => {
    expect(resolve({})?.tz).toBe("America/Sao_Paulo");
    expect(resolve({ ADMIN_TZ: "Europe/Lisbon" })?.tz).toBe("Europe/Lisbon");
    expect(resolve({ ADMIN_TZ: "Marte/Base" })?.tz).toBe("UTC");
  });
});
