import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionUpload } from "../../hooks/useSessionUpload.ts";
import { compressPhoto } from "../../lib/compressPhoto.ts";

vi.mock("../../lib/compressPhoto.ts", () => ({
  compressPhoto: vi.fn(),
  isCompressiblePhoto: (file: File) => file.type === "image/jpeg",
}));

afterEach(() => vi.unstubAllGlobals());

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
