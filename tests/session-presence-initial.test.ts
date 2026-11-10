import { describe, it, expect } from "vitest";
import { SessionService } from "../src/services/session-service.js";
import { SessionStore } from "../src/session/store.js";
import { FakeClock } from "../src/session/clock.js";
import type { Config } from "../src/utils/config.js";

describe("Presença inicial na criação e no pareamento (H5)", () => {
  const dummyConfig: Config = {
    host: "0.0.0.0",
    port: 3000,
    tempDir: "/tmp/dns-presence-test",
    maxFileSize: 1000,
    maxFilesPerSession: 10,
    allowedOrigins: ["*"],
    publicBaseUrl: "http://localhost:3000",
    heartbeatTimeoutMs: 25000,
    wsAuthTimeoutMs: 5000,
    cleanupMaxAttempts: 5,
    cleanupInitialDelayMs: 100,
  };

  it("criação de sessão inicializa lastSeen.computer com clock.now() e primeiro tick mantém o computador presente", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: dummyConfig.tempDir });
    const service = new SessionService(store, dummyConfig, clock);

    const session = await service.create();

    // lastSeen.computer deve ser inicializado com clock.now()
    expect(session.lastSeen.computer).toBe(1000);
    expect(store.isComputerPresent(session.id)).toBe(true);

    // No primeiro tick (1s depois), computador não deve ser considerado perdido
    clock.advance(1000); // t=2000
    await store.tick();

    expect(store.isComputerPresent(session.id)).toBe(true);
    expect(store.getById(session.id)!.state).toBe("WAITING");
  });

  it("pareamento inicializa lastSeen.phone com clock.now() e primeiro tick não move para DISCONNECTED", async () => {
    const clock = new FakeClock(1000);
    const store = new SessionStore({ clock, tempDir: dummyConfig.tempDir });
    const service = new SessionService(store, dummyConfig, clock);

    const session = await service.create();

    // Avança 5s e faz o pareamento
    clock.advance(5000); // t=6000
    const pairResult = service.pair(session.id, session.rawQrToken);
    expect(pairResult.ok).toBe(true);

    const pairedSession = store.getById(session.id)!;
    expect(pairedSession.state).toBe("PAIRED");
    // lastSeen.phone DEVE ser inicializado com o momento do pareamento
    expect(pairedSession.lastSeen.phone).toBe(6000);
    expect(store.isPhonePresent(session.id)).toBe(true);

    // No próximo tick (1s depois), telefone não deve ser considerado ausente
    clock.advance(1000); // t=7000
    await store.tick();

    const afterTick = store.getById(session.id)!;
    // NÃO deve ter mudado para DISCONNECTED!
    expect(afterTick.state).toBe("PAIRED");
    expect(afterTick.phoneLostAt).toBeNull();
  });
});
