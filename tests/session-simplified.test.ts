import { describe, it, expect } from "vitest";
import { FakeClock } from "../src/session/clock.js";
import { SessionStore } from "../src/session/store.js";
import { SessionService } from "../src/services/session-service.js";
import type { Config } from "../src/utils/config.js";

const config: Config = {
  host: "0.0.0.0",
  port: 3000,
  tempDir: "/tmp/dns-simplified-test",
  maxFileSize: 1000,
  maxFilesPerSession: 10,
  allowedOrigins: ["*"],
  publicBaseUrl: "http://localhost:3000",
  heartbeatTimeoutMs: 25_000,
  wsAuthTimeoutMs: 5_000,
  cleanupMaxAttempts: 5,
  cleanupInitialDelayMs: 100,
};

function setup() {
  const clock = new FakeClock(1000);
  const store = new SessionStore({ clock, tempDir: config.tempDir });
  const service = new SessionService(store, config, clock);
  return { clock, store, service };
}

describe("Sessão sem encerramento automático", () => {
  it("computador e celular ausentes não fecham a sessão", async () => {
    const { clock, store, service } = setup();
    const session = await service.create();
    service.pair(session.id, session.rawQrToken);

    // Bem além de qualquer timeout de presença
    clock.advance(24 * 60 * 60 * 1000);
    await store.tick();

    const stored = store.getById(session.id)!;
    expect(stored.state).toBe("DISCONNECTED");
    expect(stored.closedReason).toBeNull();
    expect(stored.computerTokenHash).not.toBe("");
  });

  it("celular que volta depois de horas continua aceitando upload", async () => {
    const { clock, store, service } = setup();
    const session = await service.create();
    const paired = service.pair(session.id, session.rawQrToken);
    expect(paired.ok).toBe(true);

    clock.advance(6 * 60 * 60 * 1000);
    await store.tick();
    expect(store.getById(session.id)!.state).toBe("DISCONNECTED");

    store.recordHeartbeat(session.id, "phone");
    expect(store.getById(session.id)!.state).toBe("PAIRED");
  });

  it("só closeSession explícito encerra a sessão", async () => {
    const { clock, store, service } = setup();
    const session = await service.create();

    clock.advance(60 * 60 * 1000);
    await store.tick();
    expect(store.getById(session.id)!.state).toBe("WAITING");

    await store.closeSession(session.id, "user_closed");
    expect(store.getById(session.id)!.state).toBe("CLOSED");
  });
});
