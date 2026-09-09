import { defineConfig } from "vitest/config";

/**
 * Its own config because `vite.config.ts` roots at `src/client` to build the
 * PWA, and vitest would inherit that root and never see `test/`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
