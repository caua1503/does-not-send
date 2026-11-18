/**
 * Que bug pega: participante contado de novo no reconnect, ou evento emitido
 * antes do session_created (o INSERT cairia na FK e seria descartado).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";
import { InMemoryRecorder } from "../src/recording/index.js";
import type { AppContext } from "../src/app.js";

describe("eventos de participante", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let recorder: InMemoryRecorder;

  afterEach(async () => {
    if (app) await app.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function setup(): Promise<AppContext> {
    tempDir = await mkdtemp(join(tmpdir(), "dns-participant-events-"));
    recorder = new InMemoryRecorder();
    app = await buildApp(
      { ...loadConfig(), tempDir },
      { startSweeper: false, recorder },
    );
    return (app as unknown as { ctx: AppContext }).ctx;
  }

  function joinedEvents() {
    return recorder.getEvents().filter((event) => event.type === "participant_joined");
  }

  it("twoway: host e convidados entram uma vez; autenticar de novo não duplica", async () => {
    const ctx = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { mode: "twoway" },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json() as { id: string; hostId: string; qrToken: string };

    const joinAna = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { name: "Ana", qrToken: session.qrToken },
    });
    const joinBia = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/participants`,
      payload: { name: "Bia", qrToken: session.qrToken },
    });
    expect(joinAna.statusCode).toBe(201);
    expect(joinBia.statusCode).toBe(201);
    const ana = joinAna.json() as { credential: string };

    // Reconnect path: authenticating the stored credential must not count again.
    const stored = ctx.sessionStore.getById(session.id)!;
    expect(ctx.participantService.authenticate(stored, ana.credential)).not.toBeNull();

    const events = joinedEvents();
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.role)).toEqual(["host", "guest", "guest"]);
    expect(new Set(events.map((event) => event.participantId)).size).toBe(3);
    expect(events.every((event) => event.sessionId === session.id)).toBe(true);
  });

  it("oneway: criação e pareamento não geram participante", async () => {
    await setup();
    const created = await app.inject({ method: "POST", url: "/api/sessions" });
    const session = created.json() as { id: string; qrToken: string };

    await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });
    await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/pair`,
      payload: { qrToken: session.qrToken },
    });

    expect(joinedEvents()).toHaveLength(0);
  });
});
