import { cp } from "node:fs/promises";
import { extname } from "node:path";
import { defineConfig } from "tsup";

// Every module under src/ is its own entry, so each "./*" subpath export has a
// matching dist file. Splitting puts shared code in chunks, so two subpaths
// don't each carry their own copy of a module.
export default defineConfig({
  entry: ["src/**/*.ts"],
  format: ["esm"],
  platform: "neutral",
  target: "es2020",
  dts: true,
  splitting: true,
  clean: true,
  outDir: "dist",
  // The title word lists get bundled into the js, but they also ship as plain
  // json so other tools can read or extend them.
  async onSuccess() {
    await cp("src/parse/title-words", "dist/parse/title-words", {
      recursive: true,
      filter: (path) => ["", ".json"].includes(extname(path)),
    });
  },
});
