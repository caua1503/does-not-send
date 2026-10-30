import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";

describe("Static routes and SPA fallback", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) {
      await cleanupTestApp(ctx);
    }
  });

  it("serves index.html with web CSP on GET /", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("connect-src 'self' ws: wss:");
  });

  it("handles SPA route fallback without 500 error", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/enviar/some-token",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("keeps default-src 'none' on API routes", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'");
  });
});
