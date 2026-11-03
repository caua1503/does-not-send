import { randomInt } from "node:crypto";

export const VISUAL_ID_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CHARSET_LENGTH = VISUAL_ID_CHARSET.length; // 31
const ID_LENGTH = 6;
const MAX_ATTEMPTS = 10;

function generateRawVisualId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = randomInt(0, CHARSET_LENGTH);
    id += VISUAL_ID_CHARSET[idx];
  }
  return id;
}

/**
 * Generates an unbiased 6-character visual ID using randomInt(0, 31).
 * Optionally checks against existing active visual IDs, retrying up to 10 times.
 */
export function generateVisualId(existingActiveIds?: Set<string>): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateRawVisualId();
    if (!existingActiveIds || !existingActiveIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Failed to generate unique visual ID: visual id collision limit reached");
}
