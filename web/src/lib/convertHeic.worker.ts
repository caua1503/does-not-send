import libheif from "libheif-js";
import type { ImageWorkerResult } from "./imageWorker.ts";

self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  let result: ImageWorkerResult;
  try {
    const images = new libheif.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
    const image = images[0];
    if (!image) throw new Error("HEIC conversion produced no image");
    const width = image.get_width();
    const height = image.get_height();
    if (width < 1 || height < 1 || width * height > 64_000_000) {
      throw new Error("Unsupported HEIC dimensions");
    }
    const pixels = await new Promise<ImageData>((resolve, reject) => {
      image.display(new ImageData(width, height), (data) => {
        if (data) resolve(data);
        else reject(new Error("Could not decode HEIC pixels"));
      });
    });

    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : null;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.putImageData(pixels, 0, 0);
      result = { image: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 }) };
    } else {
      const { encode } = await import("jpeg-js");
      result = { image: new Blob([new Uint8Array(encode(pixels, 90).data)], { type: "image/jpeg" }) };
    }
  } catch (error) {
    result = { error: String(error) };
  }
  self.postMessage(result);
};
