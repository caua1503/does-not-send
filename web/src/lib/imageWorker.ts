export type ImageWorkerResult = { image: Blob } | { error: string };

export function runImageWorker(
  worker: Worker,
  input: unknown,
  timeoutMs: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Image processing timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = ({ data }: MessageEvent<ImageWorkerResult>) => {
      cleanup();
      if ("image" in data) resolve(data.image);
      else reject(new Error(data.error));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Image worker failed"));
    };
    worker.onerror = onError;
    worker.onmessageerror = onError;
    try {
      worker.postMessage(input);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
