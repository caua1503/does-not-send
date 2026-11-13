import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset URLs: the admin shell is served from web/dist/admin, so its
  // assets resolve to /admin/assets/* (the only place the panel's CSP allows).
  base: "./",
  plugins: [react(), tailwindcss()],
  // Dev only: same-origin API/WS through Vite, so the browser never dials
  // the backend port directly (localhost IPv6 vs WSL IPv4 breaks WebSocket).
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        // Served verbatim from web/dist/admin by the Fastify /admin route.
        admin: resolve(__dirname, "admin.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (info) =>
          info.names.some((name) => name.endsWith(".css"))
            ? "assets/[name]-[hash][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    globals: true,
  },
  define: {
    __BASE_URL__: JSON.stringify(process.env.VITE_PUBLIC_BASE_URL ?? ""),
  },
});
