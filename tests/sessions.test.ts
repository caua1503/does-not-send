import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";

describe("sessions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  describe("creation", () => {
    it("creates a session with tokens and id", async () => {
      const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.ownerToken).toBeDefined();
      expect(body.uploadToken).toBeDefined();
      expect(body.ownerToken).not.toBe(body.uploadToken);
      expect(body.ownerToken.length).toBeGreaterThanOrEqual(32); // 128 bits hex = 32 chars minimum
      expect(body.uploadToken.length).toBeGreaterThanOrEqual(32);
      expect(body.createdAt).toBeDefined();
    });

    it("creates multiple sessions for same client", async () => {
      const s1 = await createSession(ctx.app);
      const s2 = await createSession(ctx.app);
      expect(s1.id).not.toBe(s2.id);
      expect(s1.ownerToken).not.toBe(s2.ownerToken);
    });
  });

  describe("get session", () => {
    it("returns session info with owner token", async () => {
      const session = await createSession(ctx.app);
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(session.id);
      expect(body.state).toBe("active");
    });
  });

  describe("close session", () => {
    it("closes session with owner token", async () => {
      const session = await createSession(ctx.app);
      const res = await ctx.app.inject({
        method: "DELETE",
        url: `/api/sessions/${session.id}`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      expect(res.statusCode).toBe(204);

      // Cannot access closed session
      const res2 = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      expect(res2.statusCode).toBe(401);
    });
  });

  describe("heartbeat", () => {
    it("updates last activity", async () => {
      const session = await createSession(ctx.app);
      const before = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      const beforeActivity = before.json().lastActivity;

      // Small delay for timestamp difference
      await new Promise((r) => setTimeout(r, 50));

      const hb = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/heartbeat`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      expect(hb.statusCode).toBe(200);

      const after = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: { authorization: `Bearer ${session.ownerToken}` },
      });
      const afterActivity = after.json().lastActivity;
      expect(afterActivity).not.toBe(beforeActivity);
    });
  });

  describe("expiration", () => {
    it("expires session after idle timeout", async () => {
      const shortCtx = await createTestApp({ sessionIdleTimeout: 200 });
      try {
        const session = await createSession(shortCtx.app);

        // Session is active
        const res1 = await shortCtx.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { authorization: `Bearer ${session.ownerToken}` },
        });
        expect(res1.statusCode).toBe(200);

        // Wait for expiration
        await new Promise((r) => setTimeout(r, 400));

        // Session should be expired/closed
        const res2 = await shortCtx.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { authorization: `Bearer ${session.ownerToken}` },
        });
        expect(res2.statusCode).toBe(401);
      } finally {
        await cleanupTestApp(shortCtx);
      }
    });
  });
});
