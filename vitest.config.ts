import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `obsidian` ships only type declarations (package.json "main": ""), so it
// cannot be imported at runtime. Alias it to a hand-written stub that provides
// the base classes / functions the plugin touches when `src/main.ts` loads and
// when `fetchRecipes` runs. Network (`requestUrl`) is controllable per-test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: fileURLToPath(
        new URL("./test/helpers/obsidian-stub.ts", import.meta.url),
      ),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
