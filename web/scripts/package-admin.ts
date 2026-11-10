import { copyFileSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

// Vite shares hashed chunks between both HTML entries, so copy (not move) —
// the SPA's index.html still references the same chunk under /assets/.
// The admin page is served from web/dist/admin and its CSP only allows assets
// under /admin/assets/. Vite emits relative "./assets/" URLs (which browsers
// resolve against "/" on /admin), so rewrite them to "/admin/assets/" and copy
// the referenced files there, keeping the entry/chunk graph intact.
const dist = resolve(import.meta.dir, "../dist");
const source = resolve(dist, "admin.html");
const targetDir = resolve(dist, "admin");
const targetAssets = resolve(targetDir, "assets");

if (!existsSync(source)) {
  console.error("web/dist/admin.html not found; run vite build first");
  process.exit(1);
}

const rawHtml = readFileSync(source, "utf8");
const html = rawHtml.replace(/((?:src|href)=")\.\/assets\//g, "$1/admin/assets/");
const referenced = [...rawHtml.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((m) => m[1]!);
if (referenced.length === 0) {
  console.error("admin.html references no ./assets/ files; refusing to package");
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetAssets, { recursive: true });

// Bundle chunks imported by the entry (hash-named) plus the fonts its CSS pulls in.
const assetsDir = resolve(dist, "assets");
const css = referenced.filter((file) => file.endsWith(".css"));
const fonts = css.flatMap((file) => {
  const source = resolve(assetsDir, file);
  if (!existsSync(source)) return [];
  return [...readFileSync(source, "utf8").matchAll(/url\((?:\.\/)?([^)"']+\.woff2)\)/g)].map(
    (m) => basename(m[1]!),
  );
});

for (const file of new Set([...referenced, ...fonts])) {
  const from = resolve(assetsDir, file);
  if (!existsSync(from)) {
    console.error(`missing asset ${file}`);
    process.exit(1);
  }
  copyFileSync(from, resolve(targetAssets, file));
}

writeFileSync(resolve(targetDir, "index.html"), html);
rmSync(source, { force: true });
console.log(`admin shell → web/dist/admin/index.html (+${new Set([...referenced, ...fonts]).size} assets)`);
