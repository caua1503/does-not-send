import { expect, it, vi } from "vitest";
import { runImageWorker } from "../../lib/imageWorker.ts";

it("terminates a stalled image worker before rejecting so another decode can start", async () => {
  vi.useFakeTimers();
  try {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const result = runImageWorker(worker as unknown as Worker, "job", 100);
    const rejection = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(worker.postMessage).toHaveBeenCalledWith("job");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
