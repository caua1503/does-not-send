import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionRepository } from "../repositories/session-repository.js";

/**
 * Remove orphan directories in tempDir that don't belong to any active session.
 * Called on startup.
 */
export async function cleanOrphans(tempDir: string, repository: SessionRepository): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch {
    // Directory doesn't exist yet — nothing to clean
    return;
  }

  const activeIds = repository.getActiveIds();

  for (const entry of entries) {
    if (!activeIds.has(entry)) {
      const fullPath = join(tempDir, entry);
      try {
        await rm(fullPath, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
}
