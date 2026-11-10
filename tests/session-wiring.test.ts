import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";

describe("session wiring (integration)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await cleanupTestApp(ctx);
  });

  it("POST /sessions returns qrToken in response body", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; ownerToken: string; qrToken: string }>();
    expect(typeof body.qrToken).toBe("string");
    expect(body.qrToken.length).toBeGreaterThanOrEqual(32);
  });

  it("session created with WAITING state, qrTokenHash stored, raw token not on session object", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, qrToken } = res.json<{
      id: string;
      ownerToken: string;
      qrToken: string;
    }>();

    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionStore.getById(id);

    expect(session.state).toBe("WAITING");
    expect(session.qrTokenHash).toBeDefined();
    expect(session.qrTokenHash).not.toBe(qrToken);
    expect(JSON.stringify(session)).not.toContain(qrToken);
  });

  it("DELETE /sessions/:id closes session (CLOSED state via transition)", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, ownerToken } = res.json<{ id: string; ownerToken: string }>();

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(del.statusCode).toBe(204);

    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionStore.getById(id);
    expect(session?.state).toBe("CLOSED");
  });
});
