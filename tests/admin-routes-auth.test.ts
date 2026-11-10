import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN = { user: "admin", password: "admin", tz: "America/Sao_Paulo" };
const JSON_HEADERS = { "content-type": "application/json" };
const ORIGINAL_ENV = { ...process.env };

let ctx: TestContext | undefined;
let raw: FastifyInstance | undefined;

afterEach(async () => {
  if (ctx) await cleanupTestApp(ctx);
  if (raw) await raw.close();
  ctx = undefined;
  raw = undefined;
  process.env = { ...ORIGINAL_ENV };
});

async function withAdmin(): Promise<FastifyInstance> {
  ctx = await createTestApp({ admin: ADMIN }, { startSweeper: false });
  return ctx.app;
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const header = String(res.headers["set-cookie"]);
  return header.split(";")[0]!;
}

async function login(app: FastifyInstance, password = "admin"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    headers: JSON_HEADERS,
    payload: { username: "admin", password },
  });
  expect(res.statusCode).toBe(200);
  return cookieFrom(res);
}

describe("login e sessão do painel", () => {
  it("login correto devolve cookie HttpOnly/Strict/Path=/admin e me confirma", async () => {
    // Que bug pega: atributos do cookie regredindo (JS leria o token, ou vaza em requisições de outros sites).
    const app = await withAdmin();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: JSON_HEADERS,
      payload: { username: "admin", password: "admin" },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/admin/i);
    expect(setCookie).toMatch(/Max-Age=28800/);
    expect(setCookie).not.toMatch(/Secure/i); // HTTP => sem Secure
    expect(res.headers["cache-control"]).toContain("no-store");

    const me = await app.inject({ method: "GET", url: "/admin/api/me", headers: { cookie: cookieFrom(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ authenticated: true });
  });

  it("erro de login é genérico e igual para usuário inexistente", async () => {
    const app = await withAdmin();
    const wrongPass = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: JSON_HEADERS,
      payload: { username: "admin", password: "nope" },
    });
    const noUser = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: JSON_HEADERS,
      payload: { username: "fantasma", password: "nope" },
    });
    expect(wrongPass.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPass.json()).toEqual(noUser.json());
    expect(wrongPass.headers["set-cookie"]).toBeUndefined();
  });

  it("rotas /admin/api exigem sessão e levam no-store", async () => {
    const app = await withAdmin();
    const res = await app.inject({ method: "GET", url: "/admin/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("logout revoga o token no servidor", async () => {
    // Que bug pega: logout que só apaga o cookie deixaria o token reutilizável por 8h.
    const app = await withAdmin();
    const cookie = await login(app);
    const out = await app.inject({ method: "POST", url: "/admin/api/logout", headers: { ...JSON_HEADERS, cookie }, payload: {} });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    const me = await app.inject({ method: "GET", url: "/admin/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("POST sem Content-Type JSON é recusado e sem Origin estranho também", async () => {
    // Que bug pega: login por formulário/CSRF cross-site.
    const app = await withAdmin();
    const noJson = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "username=admin&password=admin",
    });
    expect(noJson.statusCode).toBe(415);
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: { ...JSON_HEADERS, origin: "https://evil.example" },
      payload: { username: "admin", password: "admin" },
    });
    expect(crossOrigin.statusCode).toBe(403);
    const sameOrigin = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: { ...JSON_HEADERS, origin: "http://localhost:3000", host: "localhost:3000" },
      payload: { username: "admin", password: "admin" },
    });
    expect(sameOrigin.statusCode).toBe(200);
  });

  it("5 falhas bloqueiam o IP com 429 e Retry-After; senha certa também é barrada", async () => {
    // Que bug pega: força bruta sem bloqueio no endpoint real.
    const app = await withAdmin();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        headers: JSON_HEADERS,
        payload: { username: "admin", password: `errada-${i}` },
      });
      expect(res.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: JSON_HEADERS,
      payload: { username: "admin", password: "admin" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: "too_many_attempts" } });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("HTTPS liga Secure no cookie", async () => {
    // Que bug pega: cookie de admin trafegando sem Secure atrás de um proxy TLS.
    process.env.TRUST_PROXY = "true";
    ctx = await createTestApp({ admin: ADMIN, publicBaseUrl: "https://admin.example.com" }, { startSweeper: false });
    const app = ctx.app;
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: {
        ...JSON_HEADERS,
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.7",
        origin: "https://admin.example.com",
        host: "admin.example.com",
      },
      payload: { username: "admin", password: "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toMatch(/; Secure/);
  });
});

describe("produção sem credencial válida", () => {
  it("/admin não existe (404, sem cookie), e o resto do app responde", async () => {
    // Que bug pega: painel exposto em produção com senha padrão.
    process.env.NODE_ENV = "production";
    delete process.env.ADMIN_PASSWORD;
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    const config = loadConfig();
    expect(config.admin).toBeUndefined();
    raw = await buildApp(config, { startSweeper: false });

    const loginRes = await raw.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: JSON_HEADERS,
      payload: { username: "admin", password: "admin" },
    });
    expect(loginRes.statusCode).toBe(404);
    const me = await raw.inject({ method: "GET", url: "/admin/api/me" });
    expect(me.statusCode).toBe(404);
    const page = await raw.inject({ method: "GET", url: "/admin" });
    expect(page.statusCode).toBe(404);
    expect(page.body).not.toContain("<div id=\"root\"");

    expect((await raw.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await raw.inject({ method: "POST", url: "/api/sessions" })).statusCode).toBe(201);
  });

  it("em produção com senha fraca (<12) também não registra", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_PASSWORD = "curta123456";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    expect(loadConfig().admin).toBeUndefined();
  });

  it("em produção com senha válida, /admin existe", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_PASSWORD = "uma-senha-bem-longa";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    const config = loadConfig();
    expect(config.admin).toBeDefined();
    raw = await buildApp(config, { startSweeper: false });
    const res = await raw.inject({ method: "GET", url: "/admin/api/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("página /admin", () => {
  it("envia no-store, CSP restritiva e Referrer-Policy", async () => {
    const app = await withAdmin();
    const res = await app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(503); // frontend não compilado no ambiente de teste
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(String(res.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    expect(String(res.headers["content-security-policy"])).toContain("script-src 'self'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
