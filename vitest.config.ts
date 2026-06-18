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
      // Match the production build: render through preact/compat, not react-dom.
      // `src/main` transitively imports the React views, so the test runtime
      // must resolve the same way the bundle does.
      "react-dom/client": "preact/compat/client",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react-dom": "preact/compat",
      react: "preact/compat",
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
