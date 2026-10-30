import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison to prevent timing attacks */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare with itself to keep timing constant
    const buf = Buffer.from(a, "utf-8");
    timingSafeEqual(buf, buf);
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}
