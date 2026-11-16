import type { DeviceKind } from "./api.ts";

export function detectDevice(): DeviceKind {
  try {
    return window.matchMedia("(pointer: coarse)").matches ? "phone" : "desktop";
  } catch {
    return "phone";
  }
}
