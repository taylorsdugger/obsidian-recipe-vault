import type { ParseOptions } from "@recipe-vault/core";

/**
 * The plugin's default filler-word settings. The web app has no settings
 * screen yet, so every import cleans titles the same way the plugin does.
 */
export const PARSE_OPTIONS: ParseOptions = {
  fillerWordsMode: "auto",
  customFillerWords: "",
  filterVeganWords: true,
  filterGlutenFreeWords: true,
};
