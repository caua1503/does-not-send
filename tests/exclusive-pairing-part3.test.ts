import { describe, it, expect } from "vitest";
import { FakeClock } from "../src/session/clock.js";
import { SessionStore } from "../src/session/store.js";
import { hashToken } from "../src/session/pairing.js";
import type { Session } from "../src/types.js";

describe("Parte 3: Presence and Sweeper", () => {
  it("WS aberto sem heartbeat por 25s+ conta como ausente", () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-1",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: {
        computer: 1000,
        phone: 1000,
      },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Initial state: phone and computer are present at t=1000
    expect(store.isPhonePresent(session.id)).toBe(true);
    expect(store.isComputerPresent(session.id)).toBe(true);

    // Advance 25000ms: at t=26000, 26000 - 1000 = 25000ms <= 25000ms -> still present
    clock.advance(25_000);
    expect(store.isPhonePresent(session.id)).toBe(true);

    // Advance 1ms more: 25001ms > 25000ms -> absent
    clock.advance(1);
    expect(store.isPhonePresent(session.id)).toBe(false);
    expect(store.isComputerPresent(session.id)).toBe(false);
  });

  it("heartbeat renova presença", () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-hb",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: {
        computer: 1000,
        phone: 1000,
      },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // 20s later: phone sends heartbeat
    clock.advance(20_000); // t = 21000
    store.recordHeartbeat(session.id, "phone");

    // Advance 10s more: t = 31000.
    // For computer: 31000 - 1000 = 30000ms > 25000ms -> absent
    // For phone: 31000 - 21000 = 10000ms <= 25000ms -> present!
    clock.advance(10_000);
    expect(store.isPhonePresent(session.id)).toBe(true);
    expect(store.isComputerPresent(session.id)).toBe(false);

    // Computer sends heartbeat at t=31000
    store.recordHeartbeat(session.id, "computer");
    expect(store.isComputerPresent(session.id)).toBe(true);
  });

  it("auth WS inválida ou ausente em 5s fecha a conexão", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-ws-auth",
      computerTokenHash: hashToken("correct-comp-token"),
      phoneCredentialHash: hashToken("correct-phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    const fakeSocket1 = {
      readyState: 1,
      send: () => {},
      close: () => {},
    };

    // Case 1: Invalid secret fails auth immediately
    store.registerPendingWs(session.id, fakeSocket1);
    const invalidAuth = store.authenticateWs(session.id, "computer", "wrong-secret", fakeSocket1);
    expect(invalidAuth.ok).toBe(false);

    // Case 2: No auth within 5s closes connection on tick()
    let closedCode2: number | undefined;
    const fakeSocket2 = {
      readyState: 1,
      send: () => {},
      close: (code?: number) => {
        closedCode2 = code;
      },
    };
    store.registerPendingWs(session.id, fakeSocket2);

    // Advance 4999ms -> still within 5s
    clock.advance(4999);
    await store.tick();
    expect(closedCode2).toBeUndefined();

    // Advance 1ms more -> 5000ms reached -> tick closes it
    clock.advance(1);
    await store.tick();
    expect(closedCode2).toBe(4001);
  });

  it("telefone some: DISCONNECTED e uploads bloqueados na hora", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-phone-lost",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "TRANSFERRING",
      activeUploads: 1,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Register active upload
    const uploadController = new AbortController();
    store.registerUploadAbortController(session.id, uploadController);
    expect(uploadController.signal.aborted).toBe(false);

    // Advance 25001ms: phone is absent
    clock.advance(25_001);
    await store.tick();

    const updated = store.getById(session.id)!;
    expect(updated.state).toBe("DISCONNECTED");
    expect(updated.phoneLostAt).toBe(26001);
    expect(uploadController.signal.aborted).toBe(true);
  });

  it("telefone volta dentro da tolerância: volta a PAIRED e aceita upload", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-phone-reconnect",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "DISCONNECTED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: 26001,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Advance to t = 35000 (elapsed from phoneLostAt = 8999ms, < 30000ms grace)
    clock.set(35000);

    // Phone reconnects: sends auth and sends heartbeat
    const phoneSocket = { readyState: 1, send: () => {}, close: () => {} };
    const authResult = store.authenticateWs(session.id, "phone", "phone-token", phoneSocket);
    expect(authResult.ok).toBe(true);

    store.recordHeartbeat(session.id, "phone");

    const reconnected = store.getById(session.id)!;
    expect(reconnected.state).toBe("PAIRED");
    expect(reconnected.phoneLostAt).toBeNull();
    expect(store.isPhonePresent(session.id)).toBe(true);

    // After tick, remains PAIRED
    await store.tick();
    expect(store.getById(session.id)!.state).toBe("PAIRED");
  });

  it("telefone não volta em 30s: CLOSED e limpeza", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-phone-timeout",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "DISCONNECTED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: 26001,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // At 26001 + 30000 = 56001: exactly grace period, not yet expired (> 30000)
    clock.set(56001);
    await store.tick();
    expect(store.getById(session.id)!.state).toBe("DISCONNECTED");

    // 1ms later: 56002 > 30000ms grace -> CLOSED
    clock.advance(1);
    await store.tick();

    const closed = store.getById(session.id)!;
    expect(closed.state).toBe("CLOSED");
    expect(closed.closedReason).toBe("phone_lost");
    expect(closed.computerTokenHash).toBe("");
    expect(closed.phoneCredentialHash).toBeNull();
  });

  it("computador some durante transferência: uploads seguem até 30s, depois sessão CLOSED, telefone notificado, arquivos apagados", async () => {
    const { mkdtemp, writeFile, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const testTempDir = await mkdtemp(join(tmpdir(), "dns-comp-lost-"));
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: testTempDir });

    const session: Session = {
      id: "session-comp-lost",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "TRANSFERRING",
      activeUploads: 1,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Create session dir with a dummy file
    const sessionDir = join(testTempDir, session.id);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "dummy.txt"), "hello world");

    // Phone is connected via WS
    const receivedPhoneMessages: string[] = [];
    let phoneWsClosed = false;
    const phoneSocket = {
      readyState: 1,
      send: (data: string) => {
        receivedPhoneMessages.push(data);
      },
      close: () => {
        phoneWsClosed = true;
      },
    };
    store.authenticateWs(session.id, "phone", "phone-token", phoneSocket);

    // Upload in progress with AbortController
    const uploadController = new AbortController();
    store.registerUploadAbortController(session.id, uploadController);

    // Phone keeps sending heartbeats every 10s so it remains present
    // But computer sends NO heartbeat after t=1000
    // Advance to t = 26001 (> 25s heartbeat timeout for computer)
    clock.set(26001);
    store.recordHeartbeat(session.id, "phone");
    await store.tick();

    // Computer is registered as lost for the first time
    const midway = store.getById(session.id)!;
    expect(midway.computerLostAt).toBe(26001);
    // Uploads STILL continue during grace period!
    expect(uploadController.signal.aborted).toBe(false);
    expect(midway.state).toBe("TRANSFERRING");

    // Advance 30s (still within 30s grace)
    clock.set(56001);
    store.recordHeartbeat(session.id, "phone");
    await store.tick();
    expect(uploadController.signal.aborted).toBe(false);
    expect(store.getById(session.id)!.state).toBe("TRANSFERRING");

    // Advance 1ms more (> 30s grace)
    clock.set(56002);
    await store.tick();

    const finalSession = store.getById(session.id)!;
    expect(finalSession.state).toBe("CLOSED");
    expect(finalSession.closedReason).toBe("computer_lost");
    expect(uploadController.signal.aborted).toBe(true);
    expect(phoneWsClosed).toBe(true);

    // Phone was notified with exact reason
    expect(receivedPhoneMessages).toContain(
      JSON.stringify({ type: "session_closed", reason: "computer_lost" }),
    );

    // Directory deleted
    let dirExists = true;
    try {
      await stat(sessionDir);
    } catch {
      dirExists = false;
    }
    expect(dirExists).toBe(false);

    // Clean root temp
    const { rm } = await import("node:fs/promises");
    await rm(testTempDir, { recursive: true, force: true });
  });

  it("closeSession é idempotente (duas chamadas, sem erro)", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-idempotent",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Call 1 — deve resolver sem rejeitar
    await store.closeSession(session.id, "first_close");
    expect(store.getById(session.id)!.state).toBe("CLOSED");
    expect(store.getById(session.id)!.closedReason).toBe("first_close");

    // Call 2 — idempotente: não altera closedReason
    await store.closeSession(session.id, "second_close");
    expect(store.getById(session.id)!.state).toBe("CLOSED");
    expect(store.getById(session.id)!.closedReason).toBe("first_close");
  });

  it("encerramento explícito pelo computador fecha imediatamente", async () => {
    const { mkdtemp, writeFile, stat, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const testTempDir = await mkdtemp(join(tmpdir(), "dns-comp-explicit-"));
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: testTempDir });

    const session: Session = {
      id: "session-explicit-close",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "TRANSFERRING",
      activeUploads: 1,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    const sessionDir = join(testTempDir, session.id);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "file.txt"), "data");

    const uploadController = new AbortController();
    store.registerUploadAbortController(session.id, uploadController);

    let phoneClosed = false;
    const phoneSocket = {
      readyState: 1,
      send: () => {},
      close: () => {
        phoneClosed = true;
      },
    };
    store.authenticateWs(session.id, "phone", "phone-token", phoneSocket);

    // Explicit close right now at t=1000 without waiting for any grace period!
    await store.closeSession(session.id, "user_closed");

    const closed = store.getById(session.id)!;
    expect(closed.state).toBe("CLOSED");
    expect(closed.closedReason).toBe("user_closed");
    expect(uploadController.signal.aborted).toBe(true);
    expect(phoneClosed).toBe(true);

    let dirExists = true;
    try {
      await stat(sessionDir);
    } catch {
      dirExists = false;
    }
    expect(dirExists).toBe(false);

    await rm(testTempDir, { recursive: true, force: true });
  });

  it("corrida: reconexão e expiração no mesmo tick (resultado determinístico: a reconexão processada antes do tick vence)", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-race",
      computerTokenHash: hashToken("comp-token"),
      phoneCredentialHash: hashToken("phone-token"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "DISCONNECTED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: 26001,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // Jump to the exact moment where phoneGrace has expired (> 30000ms from phoneLostAt)
    clock.set(56002);

    // Reconnection is processed right before tick() runs in the event loop:
    const phoneSocket = { readyState: 1, send: () => {}, close: () => {} };
    const authOk = store.authenticateWs(session.id, "phone", "phone-token", phoneSocket);
    expect(authOk.ok).toBe(true);
    store.recordHeartbeat(session.id, "phone");

    // Reconnection processed before tick() -> tick() runs
    await store.tick();

    const result = store.getById(session.id)!;
    // Reconnection won: session is alive and PAIRED!
    expect(result.state).toBe("PAIRED");
    expect(result.phoneLostAt).toBeNull();
    expect(result.closedReason).toBeNull();
  });

  it("sessões isoladas: expirar a sessão A não afeta a B", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const sessionA: Session = {
      id: "session-A",
      computerTokenHash: hashToken("comp-A"),
      phoneCredentialHash: hashToken("phone-A"),
      visualId: "AAA-111",
      shortId: "AAA-111",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "DISCONNECTED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: 26001,
      computerLostAt: null,
      closedReason: null,
    };

    const sessionB: Session = {
      id: "session-B",
      computerTokenHash: hashToken("comp-B"),
      phoneCredentialHash: hashToken("phone-B"),
      visualId: "BBB-222",
      shortId: "BBB-222",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };

    store.create(sessionA);
    store.create(sessionB);

    // Advance clock to when A's grace period expires
    clock.set(56002);

    // B has active heartbeats at t=56000
    store.recordHeartbeat(sessionB.id, "phone");
    store.recordHeartbeat(sessionB.id, "computer");

    await store.tick();

    // Session A is CLOSED
    expect(store.getById("session-A")!.state).toBe("CLOSED");
    expect(store.getById("session-A")!.closedReason).toBe("phone_lost");

    // Session B is completely unaffected
    const b = store.getById("session-B")!;
    expect(b.state).toBe("PAIRED");
    expect(b.phoneLostAt).toBeNull();
    expect(b.computerLostAt).toBeNull();
    expect(b.closedReason).toBeNull();
    expect(b.computerTokenHash).not.toBe("");
    expect(b.phoneCredentialHash).not.toBeNull();
  });

  it("nenhum timer pendente após closeSession e shutdown do store", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: "/tmp" });

    const session: Session = {
      id: "session-shutdown",
      computerTokenHash: hashToken("comp-1"),
      phoneCredentialHash: hashToken("phone-1"),
      visualId: "ABC-123",
      shortId: "ABC-123",
      qrTokenHash: null,
      qrConsumedAt: "2026-11-03T00:00:00Z",
      isPaired: true,
      state: "PAIRED",
      activeUploads: 0,
      createdAt: new Date(clock.now()).toISOString(),
      lastActivity: new Date(clock.now()).toISOString(),
      files: [],
      lastSeen: { computer: 1000, phone: 1000 },
      phoneLostAt: null,
      computerLostAt: null,
      closedReason: null,
    };
    store.create(session);

    // In production, startSweeper creates the single interval
    store.startSweeper(1000);

    // Close session
    await store.closeSession(session.id, "test");

    // Shutdown store
    store.shutdown();

    // Verify sweeperTimer is null
    expect((store as unknown as { sweeperTimer: unknown }).sweeperTimer).toBeNull();
  });

  it("upload em sessão CLOSED recusado (410)", async () => {
    const { createTestApp, cleanupTestApp, createSession, createMultipartPayload } = await import(
      "./helpers.js"
    );
    const clock = new FakeClock(1000);
    const ctx = await createTestApp(undefined, { clock });

    try {
      const session = await createSession(ctx.app);
      const appCtx = (ctx.app as unknown as { ctx: { sessionStore: SessionStore } }).ctx;

      // Close session
      await appCtx.sessionStore.closeSession(session.id, "closed");

      // Attempt upload
      const { body, contentType } = createMultipartPayload([
        { name: "file", content: Buffer.from("data"), filename: "test.txt" },
      ]);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/files`,
        headers: {
          authorization: `Bearer ${session.uploadToken}`,
          "content-type": contentType,
        },
        body,
      });

      expect(res.statusCode).toBe(410);
      expect(res.json()).toMatchObject({ statusCode: 410, error: "Session is closed" });
    } finally {
      await cleanupTestApp(ctx);
    }
  });

  it("endpoint de estado expõe state, phonePresent, computerPresent, activeUploads, visualId", async () => {
    const { createTestApp, cleanupTestApp, createSession } = await import("./helpers.js");
    const clock = new FakeClock(1000);
    const ctx = await createTestApp(undefined, { clock });

    try {
      const session = await createSession(ctx.app);
      const appCtx = (ctx.app as unknown as { ctx: { sessionStore: SessionStore } }).ctx;

      // Computer and phone send heartbeat
      appCtx.sessionStore.recordHeartbeat(session.id, "computer");
      appCtx.sessionStore.recordHeartbeat(session.id, "phone");

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: {
          authorization: `Bearer ${session.ownerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json).toMatchObject({
        id: session.id,
        state: "PAIRED",
        phonePresent: true,
        computerPresent: true,
        activeUploads: 0,
        visualId: expect.any(String),
      });

      // Advance 25001ms without heartbeat
      clock.advance(25_001);
      const resAfter = await ctx.app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
        headers: {
          authorization: `Bearer ${session.ownerToken}`,
        },
      });
      const jsonAfter = resAfter.json();
      expect(jsonAfter.phonePresent).toBe(false);
      expect(jsonAfter.computerPresent).toBe(false);
    } finally {
      await cleanupTestApp(ctx);
    }
  });
});
