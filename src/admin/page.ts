import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ADMIN_DIST_PATH = resolve(__dirname, "../../web/dist/admin");

/**
 * Reads the prebuilt admin shell (Vite → web/dist/admin/index.html) once.
 * Returns undefined when the frontend has not been built; /admin then answers
 * 503 instead of failing at boot.
 */
export function loadAdminPageHtml(): string | undefined {
  const indexFile = join(ADMIN_DIST_PATH, "index.html");
  if (!existsSync(indexFile)) return undefined;
  try {
    return readFileSync(indexFile, "utf8");
  } catch {
    return undefined;
  }
}
