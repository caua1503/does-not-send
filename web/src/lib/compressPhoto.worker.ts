import imageCompression, { type Options } from "browser-image-compression";
import type { ImageWorkerResult } from "./imageWorker.ts";

self.onmessage = async ({ data }: MessageEvent<{ file: File; options: Options }>) => {
  let result: ImageWorkerResult;
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas unavailable");
    const image = await imageCompression(data.file, { ...data.options, useWebWorker: false });
    result = { image };
  } catch (error) {
    result = { error: String(error) };
  }
  self.postMessage(result);
};
