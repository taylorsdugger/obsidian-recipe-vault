import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import RecipeVault from "../../src/main";
import { DEFAULT_SETTINGS, type PluginSettings } from "../../src/settings";
import {
  resetObsidianStub,
  setRequestUrl,
  type RequestUrlResponse,
} from "./obsidian-stub";

export { resetObsidianStub, setRequestUrl };

/** Per-test settings tweaks layered over DEFAULT_SETTINGS. */
export type PluginSettingsOverride = Partial<PluginSettings>;

/**
 * Build a `RecipeVault` instance wired up just enough to call `fetchRecipes`.
 * The Obsidian `App`/`manifest` are not needed by the parser, so they're bare.
 */
export function makePlugin(
  settingsOverrides: PluginSettingsOverride = {},
): RecipeVault {
  const plugin = new RecipeVault({} as any, {} as any);
  plugin.settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...settingsOverrides,
  };
  // Keep retry backoff out of the test clock; the retry/fallback logic is
  // exercised by call counts, not real delays.
  plugin.fetchRetryDelayMs = 0;
  return plugin;
}

/** A fully-formed `requestUrl` response whose body is the given HTML. */
export function htmlResponse(html: string, status = 200): RequestUrlResponse {
  return {
    status,
    text: html,
    arrayBuffer: new ArrayBuffer(0),
    headers: {},
    json: null,
  };
}

/** Make every `requestUrl` call resolve to the given HTML. */
export function respondWith(html: string): void {
  setRequestUrl(() => htmlResponse(html));
}

/**
 * Wrap one or more JSON-LD values in a minimal HTML document, one
 * `<script type="application/ld+json">` block per value. `extraBody` lets a
 * test add DOM (e.g. WPRM notes markup) the parser also reads.
 */
export function htmlWithJsonLd(
  values: unknown | unknown[],
  extraBody = "",
): string {
  const blocks = (Array.isArray(values) ? values : [values])
    .map(
      (v) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`,
    )
    .join("\n");
  return `<!doctype html><html><head>${blocks}</head><body>${extraBody}</body></html>`;
}

/** Read a fixture file from `test/fixtures/`. */
export function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}
