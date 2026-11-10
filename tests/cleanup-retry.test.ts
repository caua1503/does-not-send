import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { SessionStore } from "../src/session/store.js";
import type { LogEntry } from "../src/utils/logger.js";
import { createTestApp, cleanupTestApp, createSession, type TestContext } from "./helpers.js";

// Counts rm calls and lets tests inject failures; delegates to the real
// implementation otherwise so removals still happen on disk.
const rmState = vi.hoisted(() => ({
  failures: [] as Array<{ code: string }>,
  calls: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (path: unknown, options?: unknown) => {
      rmState.calls.push(String(path));
      const failure = rmState.failures.shift();
      if (failure) throw Object.assign(new Error(failure.code), { code: failure.code });
      return actual.rm(path as string, options as Parameters<typeof actual.rm>[1]);
    },
  };
});

const rmCallsFor = (sessionId: string) => rmState.calls.filter((p) => p.includes(sessionId)).length;

class CaptureStream extends Writable {
  lines: LogEntry[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      try {
        this.lines.push(JSON.parse(line) as LogEntry);
      } catch {
        // non-JSON line, ignore
      }
    }
    callback();
  }
}

function storeOf(ctx: TestContext): SessionStore {
  return (ctx.app as unknown as { ctx: { sessionStore: SessionStore } }).ctx.sessionStore;
}

function makeSession(store: SessionStore, id: string) {
  const now = store.clock.now();
  return {
    id,
    computerTokenHash: "hash",
    phoneCredentialHash: null,
    visualId: "AA-BB",
    shortId: "AA-BB",
    qrTokenHash: null,
    isPaired: false,
    state: "WAITING" as const,
    activeUploads: 0,
    createdAt: new Date(now).toISOString(),
    lastActivity: new Date(now).toISOString(),
    files: [],
    lastSeen: { computer: now, phone: null },
    phoneLostAt: null,
    closedReason: null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("cleanup retry", () => {
  const captured = new CaptureStream();
  let ctx: TestContext | undefined;

  afterEach(async () => {
    rmState.failures = [];
    rmState.calls = [];
    captured.lines = [];
    if (ctx) {
      await cleanupTestApp(ctx);
      ctx = undefined;
    }
  });

  it("retries the removal after a transient failure, logging only safe fields", async () => {
    ctx = await createTestApp(undefined, { loggerStream: captured });
    const store = storeOf(ctx);
    const session = await (
      ctx.app as unknown as { ctx: { sessionService: { create(): Promise<{ id: string }> } } }
    ).ctx.sessionService.create();
    await writeFile(join(ctx.config.tempDir, session.id, "keep.bin"), "x");

    store.cleanupRetry.initialDelayMs = 10;
    rmState.failures.push({ code: "EBUSY" });
    await store.closeSession(session.id, "user_closed");

    expect(await readdir(join(ctx.config.tempDir, session.id))).toContain("keep.bin");
    const retryLine = captured.lines.find((l) => l.msg === "session cleanup retry scheduled");
    expect(retryLine).toBeTruthy();
    expect(retryLine?.sessionId).toBe(session.id);
    expect(retryLine?.code).toBe("EBUSY");

    await sleep(80);
    expect(await readdir(ctx.config.tempDir)).not.toContain(session.id);
    expect(rmCallsFor(session.id)).toBe(2);
    for (const line of captured.lines) {
      expect(JSON.stringify(line)).not.toContain(ctx.config.tempDir);
    }
  });

  it("gives up after the maximum attempts and logs an error without paths", async () => {
    ctx = await createTestApp(undefined, { loggerStream: captured });
    const store = storeOf(ctx);
    const entry = makeSession(store, "stuck-id");
    store.create(entry);
    await mkdir(join(ctx.config.tempDir, entry.id), { recursive: true });
    await writeFile(join(ctx.config.tempDir, entry.id, "keep.bin"), "x");

    store.cleanupRetry.initialDelayMs = 1;
    store.cleanupRetry.baseDelayMs = 1;
    store.cleanupRetry.maxDelayMs = 1;

    rmState.failures = Array.from({ length: 10 }, () => ({ code: "EPERM" }));
    await store.closeSession(entry.id, "user_closed");
    expect(store.getById(entry.id)?.state).toBe("CLOSED");
    await sleep(200);

    expect(rmCallsFor(entry.id)).toBe(store.cleanupRetry.maxAttempts);
    const errorLine = captured.lines.find(
      (l) => l.msg === "session cleanup failed, manual removal required",
    );
    expect(errorLine).toBeTruthy();
    expect(errorLine?.sessionId).toBe(entry.id);
    expect(errorLine?.code).toBe("EPERM");
    const logged = JSON.stringify(captured.lines);
    expect(logged).not.toContain(ctx.config.tempDir);
    expect(logged).not.toContain("keep.bin");
  });

  it("re-runs pending removals on the next sweep", async () => {
    ctx = await createTestApp(undefined, { startSweeper: false });
    const store = storeOf(ctx);
    store.cleanupRetry.initialDelayMs = 60_000;
    store.cleanupRetry.maxDelayMs = 60_000;
    const entry = makeSession(store, "sweep-id");
    store.create(entry);
    await mkdir(join(ctx.config.tempDir, entry.id), { recursive: true });

    rmState.failures = [{ code: "EBUSY" }];
    await store.closeSession(entry.id, "user_closed");
    expect(await readdir(ctx.config.tempDir)).toContain(entry.id);

    // Simulate the scheduled retry timer being lost (e.g. event loop stall);
    // the sweeper must pick the pending entry up on its next run.
    const pending = (
      store as unknown as {
        pendingCleanups: Map<
          string,
          { attempts: number; timer: ReturnType<typeof setTimeout> | null }
        >;
      }
    ).pendingCleanups.get(entry.id);
    expect(pending?.attempts).toBe(2);
    clearTimeout(pending!.timer!);
    pending!.timer = null;

    await store.tick();

    expect(await readdir(ctx.config.tempDir)).not.toContain(entry.id);
    expect(rmCallsFor(entry.id)).toBe(2);
    expect(store.getPendingCleanupIds()).toEqual([]);
  });

  it("cancels pending removals on shutdown", async () => {
    ctx = await createTestApp(undefined, { startSweeper: false });
    const store = storeOf(ctx);
    store.cleanupRetry.initialDelayMs = 10;
    const entry = makeSession(store, "shutdown-id");
    store.create(entry);
    await mkdir(join(ctx.config.tempDir, entry.id), { recursive: true });

    rmState.failures.push({ code: "EBUSY" });
    await store.closeSession(entry.id, "user_closed");
    store.shutdown();
    await sleep(120);

    expect(rmCallsFor(entry.id)).toBe(1);
    expect(store.getPendingCleanupIds()).toEqual([]);
  });

  it("DELETE request still removes the directory via retry", async () => {
    ctx = await createTestApp();
    const session = await createSession(ctx.app);
    storeOf(ctx).cleanupRetry.initialDelayMs = 10;
    rmState.failures.push({ code: "EBUSY" });

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(res.statusCode).toBe(204);

    await sleep(80);
    expect(await readdir(ctx.config.tempDir)).not.toContain(session.id);
  });
});
