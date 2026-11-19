import { afterEach, expect, it, vi } from "vitest";
import { resumableUpload } from "../../lib/resumableUpload.ts";

afterEach(() => vi.unstubAllGlobals());

it("uses the last confirmed offset after a lost response and keeps the same transfer ID", async () => {
  const chunkSize = 4 * 1024 * 1024;
  const file = new File([new Uint8Array(chunkSize * 2)], "video.mp4", { type: "video/mp4" });
  const done = { offset: file.size, fileId: "server-file", chunkSize };
  const json = (checkpoint: { offset: number; fileId: string | null; chunkSize: number }) =>
    ({ ok: true, json: async () => checkpoint });
  const fetch = vi.fn()
    .mockResolvedValueOnce(json({ offset: 0, fileId: null, chunkSize }))
    .mockResolvedValueOnce(json({ offset: chunkSize, fileId: null, chunkSize }))
    .mockResolvedValueOnce(json(done));
  vi.stubGlobal("fetch", fetch);
  const writes: Array<{ url: string; length: number }> = [];
  class MockXHR {
    upload = {};
    onload?: () => void;
    onerror?: () => void;
    status = 200;
    responseText = "";
    url = "";
    open(_method: string, url: string) { this.url = url; }
    setRequestHeader() {}
    send(blob: Blob) {
      writes.push({ url: this.url, length: blob.size });
      this.responseText = JSON.stringify(writes.length === 1
        ? { offset: chunkSize, fileId: null, chunkSize }
        : done);
      if (writes.length === 2) this.onerror?.();
      else this.onload?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", MockXHR);
  const input = {
    url: "/api/sessions/room/transfers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    credential: "guest",
    file,
    originalSize: file.size + 10,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  };
  await expect(resumableUpload(input)).rejects.toThrow("conexão");
  await expect(resumableUpload(input)).resolves.toBe("server-file");
  await expect(resumableUpload(input)).resolves.toBe("server-file");
  expect(writes).toEqual([0, chunkSize, chunkSize].map((offset) => ({
    url: `${input.url}?offset=${offset}`, length: chunkSize,
  })));
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([input.url, input.url, input.url]);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).originalSize).toBe(input.originalSize);
});
