import type { ParseOptions } from "@recipe-vault/core";

/** The two title switches on the settings screen. */
export interface TitleCleaning {
  stripFillerWords: boolean;
  stripVeganWords: boolean;
}

/**
 * Turn the settings screen's title switches into the options core's name
 * cleaner reads. Gluten-free labels have no switch in the app and stay
 * stripped, the way the plugin defaults them. The word lists follow the
 * page's language, and English covers pages that don't say.
 */
export function parseOptions(cleaning: TitleCleaning): ParseOptions {
  return {
    useBuiltInFillerWords: cleaning.stripFillerWords,
    extraFillerWords: "",
    keptFillerWords: "",
    filterVeganWords: cleaning.stripVeganWords,
    filterGlutenFreeWords: true,
    defaultLanguage: "en",
  };
}
