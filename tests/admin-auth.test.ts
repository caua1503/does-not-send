import { describe, expect, it, vi } from "vitest";
import { AdminAuth } from "../src/admin/auth.js";
import { AttemptLimiter } from "../src/admin/brute-force.js";
import { AdminSessionStore } from "../src/admin/sessions.js";
import { FakeClock } from "../src/session/clock.js";

const admin = { user: "admin", password: "senha-forte-123", tz: "UTC" };

describe("AdminAuth", () => {
  it("aceita só usuário e senha corretos", async () => {
    // Que bug pega: comparação de credenciais invertida/parcial deixaria entrar com usuário errado.
    const auth = await AdminAuth.create(admin, { warn: () => {} });
    expect(await auth.verify("admin", "senha-forte-123")).toBe(true);
    expect(await auth.verify("admin", "errada")).toBe(false);
    expect(await auth.verify("gestor", "senha-forte-123")).toBe(false);
    expect(await auth.verify("admin", "")).toBe(false);
  });

  it("não guarda a senha em texto puro no objeto de autenticação", async () => {
    const auth = await AdminAuth.create(admin, { warn: () => {} });
    const serialized = JSON.stringify(auth);
    expect(serialized).not.toContain("senha-forte-123");
  });

  it("avisa uma vez quando usa admin/admin em desenvolvimento, sem citar a senha", async () => {
    // Que bug pega: log vazando a senha padrão (ou aviso repetido a cada login).
    const warn = vi.fn();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      await AdminAuth.create({ ...admin, password: "admin" }, { warn });
    } finally {
      process.env.NODE_ENV = original;
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).not.toContain("admin/admin");
    expect(warn.mock.calls[0]![0].toLowerCase()).not.toContain("senha: admin");
  });
});

describe("AdminSessionStore", () => {
  it("guarda só o SHA-256 do token e expira em 8h", () => {
    // Que bug pega: token em claro na memória ou sessão sem validade.
    const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
    const store = new AdminSessionStore(clock);
    const { token, expiresAt } = store.issue();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(expiresAt.getTime() - clock.now()).toBe(8 * 60 * 60 * 1000);
    expect(JSON.stringify([...store["sessions"].keys()])).not.toContain(token);
    expect(store.lookup(token)).toEqual(expiresAt);

    clock.advance(8 * 60 * 60 * 1000 + 1);
    expect(store.lookup(token)).toBeNull();
  });

  it("revoga no logout e recusa token desconhecido ou gigante", () => {
    const store = new AdminSessionStore(new FakeClock(1000));
    const { token } = store.issue();
    store.revoke(token);
    expect(store.lookup(token)).toBeNull();
    expect(store.lookup(undefined)).toBeNull();
    expect(store.lookup("x".repeat(5000))).toBeNull();
  });
});

describe("AttemptLimiter", () => {
  it("5 falhas do mesmo IP bloqueiam por 15 min, com Retry-After", () => {
    // Que bug pega: força bruta livre de senha de administrador.
    const clock = new FakeClock(0);
    const limiter = new AttemptLimiter(clock);
    for (let i = 0; i < 4; i++) limiter.recordFailure("10.0.0.1");
    expect(limiter.check("10.0.0.1").blocked).toBe(false);
    limiter.recordFailure("10.0.0.1");
    expect(limiter.check("10.0.0.1")).toEqual({ blocked: true, retryAfterSeconds: 900 });
    expect(limiter.check("10.0.0.2").blocked).toBe(false);

    clock.advance(15 * 60 * 1000);
    expect(limiter.check("10.0.0.1").blocked).toBe(false);
  });

  it("janela deslizante: falhas antigas (>15 min) não contam", () => {
    const clock = new FakeClock(0);
    const limiter = new AttemptLimiter(clock);
    for (let i = 0; i < 4; i++) limiter.recordFailure("10.0.0.9");
    clock.advance(15 * 60 * 1000 + 1);
    limiter.recordFailure("10.0.0.9");
    expect(limiter.check("10.0.0.9").blocked).toBe(false);
  });

  it("30 falhas globais na hora bloqueiam todos os IPs", () => {
    // Que bug pega: ataque distribuído contornando o limite por IP.
    const clock = new FakeClock(0);
    const limiter = new AttemptLimiter(clock);
    for (let i = 0; i < 29; i++) limiter.recordFailure(`10.1.0.${i}`);
    expect(limiter.check("10.9.9.9").blocked).toBe(false);
    limiter.recordFailure("10.1.0.29");
    expect(limiter.check("10.9.9.9")).toEqual({ blocked: true, retryAfterSeconds: 3600 });
    clock.advance(60 * 60 * 1000);
    expect(limiter.check("10.9.9.9").blocked).toBe(false);
  });

  it("sweep remove IPs sem falhas recentes (mapa não cresce sem limite)", () => {
    const clock = new FakeClock(0);
    const limiter = new AttemptLimiter(clock);
    limiter.recordFailure("10.2.0.1");
    clock.advance(16 * 60 * 1000);
    limiter.sweep();
    expect(limiter["perIp"].size).toBe(0);
  });
});
