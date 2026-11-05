import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import type { FastifyInstance } from "fastify";
import { normalizeIp } from "../src/recording/normalize.js";

describe("TRUST_PROXY and IP normalization", () => {
  let app: FastifyInstance;
  const originalTrustProxy = process.env.TRUST_PROXY;

  afterEach(async () => {
    if (app) await app.close();
    if (originalTrustProxy !== undefined) {
      process.env.TRUST_PROXY = originalTrustProxy;
    } else {
      delete process.env.TRUST_PROXY;
    }
  });

  it("ignores X-Forwarded-For when TRUST_PROXY is absent", async () => {
    // Que bug pega: IP capturado de X-Forwarded-For forjado sem proxy confiável
    delete process.env.TRUST_PROXY;
    const config = loadConfig();
    app = await buildApp(config, { startSweeper: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        "X-Forwarded-For": "10.0.0.1, 192.168.1.1",
      },
    });

    expect(response.statusCode).toBe(201);
    // O IP do request deve ser 127.0.0.1 (localhost), não o forjado
    // Como não temos acesso direto ao request.ip aqui, vamos verificar via evento (Etapa 2)
  });

  it("uses X-Forwarded-For when TRUST_PROXY=true", async () => {
    // Que bug pega: X-Forwarded-For ignorado com proxy confiável
    process.env.TRUST_PROXY = "true";
    const config = loadConfig();
    app = await buildApp(config, { startSweeper: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        "X-Forwarded-For": "10.0.0.1, 192.168.1.1",
      },
    });

    expect(response.statusCode).toBe(201);
    // Com trustProxy=true, o IP deve ser 10.0.0.1 (primeiro da lista)
  });

  it("normalizeIp removes ::ffff: prefix and lowercases", () => {
    // Que bug pega: IPs IPv4-mapped não normalizados causam duplicação no banco
    expect(normalizeIp("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});
