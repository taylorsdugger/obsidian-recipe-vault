import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Builds only the client. The Worker is bundled by wrangler from
// src/worker/index.ts and serves this output as static assets.
export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  plugins: [
    preact(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // No includeAssets: globPatterns below already picks the icons up, and
      // listing them twice puts duplicate entries in the precache manifest.
      manifest: {
        name: "Recipe Vault",
        short_name: "Recipes",
        description:
          "The household's recipes, week plan, and shared shopping list.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#fafafa",
        theme_color: "#171717",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // Android's share sheet: "share to Recipes" from Chrome lands on the
        // import screen with the URL already in the field. iOS Safari has no
        // Web Share Target, so there it stays copy and paste.
        share_target: {
          action: "/import",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      },
      workbox: {
        // Cache the shell only. API responses are shared state that the other
        // phone changes, so serving them from a cache would show stale data.
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Recipe photos are hot-linked from the original site and never
            // change, so they're worth keeping offline.
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "recipe-photos",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
