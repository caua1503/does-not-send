import { request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { cleanupTestApp, createSession, createTestApp, getAppContext } from "./helpers.js";

const CHUNK = 4 * 1024 * 1024;

it("rolls back a torn chunk and replays the completed transfer without duplicating the file", async () => {
  const ctx = await createTestApp();
  try {
    const session = await createSession(ctx.app);
    const endpoint = `/api/sessions/${session.id}/transfers/${"a".repeat(32)}`;
    const auth = { authorization: `Bearer ${session.uploadToken}` };
    const first = Buffer.alloc(CHUNK, 31);
    const tail = Buffer.from("last confirmed bytes");
    const payload = { name: "large.bin", mimeType: "application/octet-stream", size: first.length + tail.length, originalSize: first.length * 2 };
    const init = (body = payload, headers = auth) => ctx.app.inject({ method: "POST", url: endpoint, headers, payload: body });
    const append = (offset: number, body: Buffer) => ctx.app.inject({
      method: "PUT", url: `${endpoint}?offset=${offset}`,
      headers: { ...auth, "content-type": "application/octet-stream" },
      payload: body,
    });

    const started = await init();
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ offset: 0, fileId: null, chunkSize: CHUNK });
    expect((await init({ ...payload, size: payload.size + 1 })).statusCode).toBe(409);
    expect((await init(payload, { authorization: `Bearer ${session.ownerToken}` })).statusCode).toBe(404);
    expect((await append(0, first)).json()).toMatchObject({ offset: CHUNK, fileId: null });

    const live = getAppContext(ctx.app).sessionStore.getById(session.id)!;
    const file = live.files[0]!;
    const path = join(ctx.tempDir, session.id, file.storageName);
    const download = () => ctx.app.inject({
      method: "GET", url: `/api/sessions/${session.id}/files/${file.id}`,
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect((await download()).statusCode).toBe(404);

    const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const partial = request(`${address}${endpoint}?offset=${CHUNK}`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/octet-stream", "content-length": tail.length },
    });
    partial.on("error", () => {});
    try {
      partial.write(tail.subarray(0, 3));
      await expect.poll(async () => (await stat(path)).size).toBe(CHUNK + 3);
      expect((await init()).json()).toMatchObject({ offset: CHUNK, fileId: null });
      expect((await append(CHUNK, tail)).statusCode).toBe(409);
      partial.destroy();
      await expect.poll(() => live.activeUploads).toBe(0);
    } finally {
      partial.destroy();
    }
    expect((await stat(path)).size).toBe(CHUNK);
    expect((await append(0, first)).statusCode).toBe(409);
    expect((await init()).json()).toMatchObject({ offset: CHUNK, fileId: null });

    const completed = await fetch(`${address}${endpoint}?offset=${CHUNK}`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/octet-stream" },
      body: tail,
    });
    expect(completed.status).toBe(200);
    const receipt = await completed.json();
    expect(receipt).toMatchObject({ offset: payload.size, fileId: file.id });
    expect((await init()).json()).toEqual(receipt);
    expect((await append(CHUNK, tail)).json()).toEqual(receipt);
    expect(live.files).toHaveLength(1);
    expect(file).toMatchObject({ state: "completed", originalSize: payload.originalSize, size: payload.size, version: 1 });
    const expected = Buffer.concat([first, tail]);
    expect((await readFile(path)).equals(expected)).toBe(true);
    expect((await download()).rawPayload.equals(expected)).toBe(true);
  } finally {
    await cleanupTestApp(ctx);
  }
});

it("counts confirmed partial bytes towards the shared storage cap", async () => {
  const ctx = await createTestApp({ maxStorageBytes: CHUNK + 1 });
  try {
    const session = await createSession(ctx.app);
    const endpoint = `/api/sessions/${session.id}/transfers/${"b".repeat(32)}`;
    const headers = { authorization: `Bearer ${session.uploadToken}` };
    const init = () => ctx.app.inject({
      method: "POST", url: endpoint, headers, payload: { name: "large.bin", size: CHUNK + 2 },
    });
    const append = (offset: number, payload: Buffer) => ctx.app.inject({
      method: "PUT", url: `${endpoint}?offset=${offset}`,
      headers: { ...headers, "content-type": "application/octet-stream" }, payload,
    });
    expect((await init()).statusCode).toBe(200);
    expect((await append(0, Buffer.alloc(CHUNK))).statusCode).toBe(200);
    expect((await append(CHUNK, Buffer.alloc(2))).statusCode).toBe(507);
    expect((await init()).json()).toMatchObject({ offset: CHUNK, fileId: null });
    const store = getAppContext(ctx.app).sessionStore;
    const file = store.getById(session.id)!.files[0]!;
    const path = join(ctx.tempDir, session.id, file.storageName);
    expect((await stat(path)).size).toBe(CHUNK);
    await store.closeSession(session.id);
    expect(file.state).toBe("failed");
    expect((await init()).statusCode).toBe(410);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await cleanupTestApp(ctx);
  }
});


it("expires an idle partial, releases its quota and starts the same ID from zero", async () => {
  const ctx = await createTestApp({ maxStorageBytes: CHUNK + 1 }, { startSweeper: false });
  try {
    const session = await createSession(ctx.app);
    const store = getAppContext(ctx.app).sessionStore;
    const endpoint = `/api/sessions/${session.id}/transfers/${"c".repeat(32)}`;
    const headers = { authorization: `Bearer ${session.uploadToken}` };
    const init = () => ctx.app.inject({
      method: "POST", url: endpoint, headers, payload: { name: "large.bin", size: CHUNK + 1 },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect((await init()).statusCode).toBe(200);
    const file = store.getById(session.id)!.files[0]!;
    const first = await ctx.app.inject({
      method: "PUT", url: endpoint + "?offset=0",
      headers: { ...headers, "content-type": "application/octet-stream" },
      payload: Buffer.alloc(CHUNK),
    });
    expect(first.statusCode).toBe(200);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    vi.useRealTimers();
    await expect.poll(() => store.getById(session.id)!.files.length).toBe(0);
    await expect(stat(join(ctx.tempDir, session.id, file.storageName))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await init()).json()).toMatchObject({ offset: 0, fileId: null });
  } finally {
    vi.useRealTimers();
    await cleanupTestApp(ctx);
  }
});
