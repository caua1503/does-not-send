import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionUpload } from "../../hooks/useSessionUpload.ts";
import { compressPhoto } from "../../lib/compressPhoto.ts";
import { convertHeicToJpeg } from "../../lib/convertHeic.ts";

vi.mock("../../lib/compressPhoto.ts", () => ({
  compressPhoto: vi.fn(),
  isCompressiblePhoto: (file: File) => file.type === "image/jpeg",
}));

vi.mock("../../lib/convertHeic.ts", () => ({
  convertHeicToJpeg: vi.fn(),
  isHeic: (file: File) => file.type === "image/heic",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("sends the original 6 MiB separately from the optimized 1 MiB file", async () => {
  const original = new File([new Uint8Array(6 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" });
  const optimized = new File([new Uint8Array(1024 * 1024)], original.name, { type: original.type });
  vi.mocked(compressPhoto).mockResolvedValueOnce(optimized);
  const send = vi.fn();
  vi.stubGlobal("XMLHttpRequest", class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send = send;
  });
  const { result } = renderHook(() => useSessionUpload({ sessionId: "room", credential: "guest", disabled: false }));
  act(() => result.current.handleFilesChosen({
    target: { files: [original] },
  } as unknown as React.ChangeEvent<HTMLInputElement>));

  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const body = send.mock.calls[0]![0] as FormData;
  expect(Number(body.get("originalSize"))).toBe(original.size);
  const file = body.get("files") as File;
  expect(file.size).toBe(optimized.size);
  expect(Number(body.get("originalSize")) - file.size).toBe(5 * 1024 * 1024);
});

it("runs one decode, sends HEIC straight to conversion and starts uploads as slots free up", async () => {
  const files = [
    new File(["heic"], "first.heic", { type: "image/heic" }),
    new File(["jpeg"], "second.jpg", { type: "image/jpeg" }),
    new File(["third"], "third.txt"),
    new File(["fourth"], "fourth.txt"),
    new File(["fifth"], "fifth.txt"),
  ];
  let finishDecode!: (file: File) => void;
  const decoding = new Promise<File>((resolve) => { finishDecode = resolve; });
  const converted = new File(["converted"], "first.jpg", { type: "image/jpeg" });
  vi.mocked(convertHeicToJpeg).mockReturnValueOnce(decoding);
  vi.mocked(compressPhoto).mockResolvedValueOnce(files[1]!);
  const requests: MockXHR[] = [];
  class MockXHR {
    upload = {};
    onload?: () => void;
    onerror?: () => void;
    status = 201;
    responseText = '{"files":[{"id":"done"}]}';
    open() {}
    setRequestHeader() {}
    send() { requests.push(this); }
  }
  vi.stubGlobal("XMLHttpRequest", MockXHR);
  const { result } = renderHook(() => useSessionUpload({ sessionId: "room", credential: "guest", disabled: false }));
  act(() => result.current.handleFilesChosen({
    target: { files },
  } as unknown as React.ChangeEvent<HTMLInputElement>));
  await waitFor(() => expect(convertHeicToJpeg).toHaveBeenCalledWith(files[0]));
  expect(compressPhoto).not.toHaveBeenCalled();
  expect(requests).toHaveLength(2);

  await act(async () => finishDecode(converted));
  expect(compressPhoto).toHaveBeenCalledExactlyOnceWith(files[1]);
  expect(requests).toHaveLength(2);
  await act(async () => requests[0]!.onerror?.());
  expect(requests).toHaveLength(3);
  for (let i = 1; i < files.length; i++) {
    await act(async () => requests[i]!.onload?.());
  }
  expect(result.current.completedFiles).toBe(4);
});
