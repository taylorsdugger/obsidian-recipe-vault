import type { ParseOptions } from "@recipe-vault/core";

/** The two title switches on the settings screen. */
export interface TitleCleaning {
  stripFillerWords: boolean;
  stripVeganWords: boolean;
}

/**
 * Turn the settings screen's title switches into the options core's name
 * cleaner reads. Core has no "off" for filler words, so off is custom mode
 * with an empty list. Gluten-free labels have no switch in the app and stay
 * stripped, the way the plugin defaults them.
 */
export function parseOptions(cleaning: TitleCleaning): ParseOptions {
  return {
    fillerWordsMode: cleaning.stripFillerWords ? "auto" : "custom",
    customFillerWords: "",
    filterVeganWords: cleaning.stripVeganWords,
    filterGlutenFreeWords: true,
  };
}
