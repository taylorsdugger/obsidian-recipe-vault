import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// Builds only the client. The Worker is bundled by wrangler from
// src/worker/index.ts and serves this output as static assets.
export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    // `vite dev` on its own has no Worker; proxy the API to `wrangler dev`.
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
