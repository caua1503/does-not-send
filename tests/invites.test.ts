import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../src/session/clock.js";
import { INVITE_TTL_MS } from "../src/session/invites.js";
import {
  cleanupTestApp,
  createSession,
  createTestApp,
  getAppContext,
  type SessionTokens,
  type TestContext,
} from "./helpers.js";

interface InviteCreated {
  code: string;
  url: string;
}

interface Redeemed {
  success: boolean;
  phoneCredential: string;
  visualId: string;
  state: string;
}

describe("convites por URL", () => {
  let ctx: TestContext;
  let clock: FakeClock;

  beforeEach(async () => {
    clock = new FakeClock(1_000_000);
    ctx = await createTestApp({}, { clock });
  });

  afterEach(async () => {
    await cleanupTestApp(ctx);
  });

  async function invite(session: SessionTokens, mode: "single" | "multi") {
    return ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/invites`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
      payload: { mode },
    });
  }

  async function createInvite(
    session: SessionTokens,
    mode: "single" | "multi",
  ): Promise<InviteCreated> {
    const res = await invite(session, mode);
    expect(res.statusCode).toBe(201);
    return res.json() as InviteCreated;
  }

  async function redeem(code: string, deviceId?: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/invites/${code}/redeem`,
      payload: deviceId ? { deviceId } : {},
    });
  }

  it("cria código de 8 caracteres e URL pública /i/:code", async () => {
    const session = await createSession(ctx.app, false);
    const created = await createInvite(session, "single");

    expect(created.code).toHaveLength(8);
    expect(created.code).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
    expect(created.url).toBe(`http://localhost:3000/i/${created.code}`);
  });

  it("GET não consome: só valida o estado", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "single");

    for (let i = 0; i < 3; i++) {
      const res = await ctx.app.inject({ method: "GET", url: `/api/invites/${code}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: "valid", sessionId: session.id });
    }

    const used = await redeem(code, "device-a");
    expect(used.statusCode).toBe(200);

    const after = await ctx.app.inject({ method: "GET", url: `/api/invites/${code}` });
    expect(after.json()).toEqual({ state: "used", sessionId: session.id });
  });

  it("single: mesmo dispositivo reusa, outro dispositivo encontra usado", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "single");

    const first = await redeem(code, "device-a");
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as Redeemed;
    expect(firstBody.success).toBe(true);
    expect(firstBody.phoneCredential).toBeTruthy();

    const again = await redeem(code, "device-a");
    expect(again.statusCode).toBe(200);
    expect((again.json() as Redeemed).phoneCredential).toBeTruthy();

    const other = await redeem(code, "device-b");
    expect(other.statusCode).toBe(410);
    expect(other.json().code).toBe("USED");

    // A credencial emitida abre a sessão normalmente.
    const info = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${(again.json() as Redeemed).phoneCredential}` },
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().state).not.toBe("CLOSED");
  });

  it("multi: pode ser resgatado várias vezes", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "multi");

    for (let i = 0; i < 3; i++) {
      const res = await redeem(code, `device-${i}`);
      expect(res.statusCode).toBe(200);
      expect((res.json() as Redeemed).phoneCredential).toBeTruthy();

      const state = await ctx.app.inject({ method: "GET", url: `/api/invites/${code}` });
      expect(state.json()).toEqual({ state: "valid", sessionId: session.id });
    }
  });

  it("não altera o QR reutilizável nem encerra a sessão", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "single");

    expect((await redeem(code, "device-a")).statusCode).toBe(200);

    const pair = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    expect(pair.statusCode).toBe(200);

    const info = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().state).not.toBe("CLOSED");
  });

  it("expirado após 24h: GET reporta e redeem recusa", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "multi");

    clock.advance(INVITE_TTL_MS);

    const state = await ctx.app.inject({ method: "GET", url: `/api/invites/${code}` });
    expect(state.json()).toEqual({ state: "expired", sessionId: session.id });

    const res = await redeem(code, "device-a");
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("EXPIRED");
  });

  it("revogado pelo anfitrião: GET reporta e redeem recusa", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "multi");

    const revoked = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/invites/${code}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(revoked.statusCode).toBe(204);

    const state = await ctx.app.inject({ method: "GET", url: `/api/invites/${code}` });
    expect(state.json()).toEqual({ state: "revoked", sessionId: session.id });

    const res = await redeem(code, "device-a");
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("REVOKED");
  });

  it("lista convites da sessão com modo e estado", async () => {
    const session = await createSession(ctx.app, false);
    const single = await createInvite(session, "single");
    const multi = await createInvite(session, "multi");

    async function list(token = session.ownerToken) {
      return ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/invites`,
        headers: { authorization: `Bearer ${token}` },
      });
    }

    const initial = await list();
    expect(initial.statusCode).toBe(200);
    expect(initial.json().invites).toEqual([
      { code: multi.code, mode: "multi", state: "valid" },
      { code: single.code, mode: "single", state: "valid" },
    ]);

    expect((await redeem(single.code, "device-a")).statusCode).toBe(200);
    expect((await list()).json().invites).toEqual([
      { code: multi.code, mode: "multi", state: "valid" },
      { code: single.code, mode: "single", state: "used" },
    ]);

    clock.advance(INVITE_TTL_MS);
    expect((await list()).json().invites).toEqual([
      { code: multi.code, mode: "multi", state: "expired" },
      { code: single.code, mode: "single", state: "used" },
    ]);

    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/invites/${multi.code}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect((await list()).json().invites).toEqual([
      { code: single.code, mode: "single", state: "used" },
    ]);

    const guest = await createSession(ctx.app, false);
    expect((await list(guest.ownerToken)).statusCode).toBe(401);
  });

  it("avisa o anfitrião pelo WebSocket quando um convite é usado", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "single");

    const sent: string[] = [];
    const hostSocket = {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      close: () => {},
    };
    const store = getAppContext(ctx.app).sessionStore;
    expect(
      store.authenticateWs(session.id, "computer", session.ownerToken, hostSocket).ok,
    ).toBe(true);

    expect((await redeem(code, "device-a")).statusCode).toBe(200);
    expect(sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: "invite:used",
      code,
      mode: "single",
      state: "used",
    });
  });

  it("só o anfitrião cria e revoga convites", async () => {
    const host = await createSession(ctx.app, false);
    const guest = await createSession(ctx.app, false);

    const created = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${host.id}/invites`,
      headers: { authorization: `Bearer ${guest.ownerToken}` },
      payload: { mode: "single" },
    });
    expect(created.statusCode).toBe(401);

    const { code } = await createInvite(host, "single");
    const revoked = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${host.id}/invites/${code}`,
      headers: { authorization: `Bearer ${guest.ownerToken}` },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("rejeita modo inválido ao criar convite", async () => {
    const session = await createSession(ctx.app, false);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/invites`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
      payload: { mode: "forever" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("limita tentativas por convite", async () => {
    const session = await createSession(ctx.app, false);
    const { code } = await createInvite(session, "multi");

    for (let i = 0; i < 10; i++) {
      expect((await redeem(code, `device-${i}`)).statusCode).toBe(200);
    }

    const blocked = await redeem(code, "device-11");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });
});
