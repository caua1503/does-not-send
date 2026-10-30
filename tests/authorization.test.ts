import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";

describe("authorization", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  it("rejects missing token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid token", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: "Bearer invalidtoken" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects token from another session", async () => {
    const s1 = await createSession(ctx.app);
    const s2 = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${s1.id}`,
      headers: { authorization: `Bearer ${s2.ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("uploadToken cannot list files", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/files`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("uploadToken cannot close session", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("uploadToken cannot get session info", async () => {
    const session = await createSession(ctx.app);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.uploadToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("closed session denies access", async () => {
    const session = await createSession(ctx.app);
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("nonexistent session returns same error as wrong token", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/sessions/nonexistent-id",
      headers: { authorization: "Bearer sometoken" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Unauthorized");
  });

  it("error response does not reveal session existence", async () => {
    const session = await createSession(ctx.app);

    // Wrong token on existing session
    const res1 = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: "Bearer wrongtoken" },
    });

    // Nonexistent session
    const res2 = await ctx.app.inject({
      method: "GET",
      url: "/api/sessions/does-not-exist",
      headers: { authorization: "Bearer wrongtoken" },
    });

    expect(res1.statusCode).toBe(res2.statusCode);
    expect(res1.json()).toEqual(res2.json());
  });
});
