// The same rules the Obsidian community plugin review bot runs. The bot scans
// shipped source across the repo, so this covers the web app and core package
// too, not only the plugin. Tests and node scripts are left out like the bot
// leaves them out.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
// Passing brands or acronyms replaces the rule's built-in lists, so extend them.
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    // wrangler dev's bundle output, gitignored in apps/web.
    "**/.wrangler/",
    "main.js",
    ".loadtest-*/",
    "**/test/",
    "**/scripts/",
    "*.mjs",
    "**/*.config.ts",
    // Other checkouts made by worktree tooling. Not this repo's source.
    ".claude/",
  ]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: [
            ...DEFAULT_BRANDS,
            "Recipe Vault",
            "OpenRouter",
            "Cooklang",
            // A brand keeps its exact casing. As an acronym it'd become URLS.
            "URLs",
          ],
          acronyms: [...DEFAULT_ACRONYMS, "JSON-LD"],
          ignoreRegex: [
            "https?://",
            // The rule wants "← back" when a label starts with a symbol.
            "^[←✎] ",
          ],
        },
      ],
    },
  },
  {
    // Workers runtime types from @cloudflare/workers-types. They're ambient
    // in the worker's tsconfig, but no-undef doesn't read types.
    files: ["apps/web/src/worker/**/*.ts"],
    languageOptions: {
      globals: {
        D1Database: "readonly",
        Fetcher: "readonly",
        R2Bucket: "readonly",
      },
    },
  },
]);
