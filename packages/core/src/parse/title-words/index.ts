import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";

/**
 * One language's title cleanup words. Every entry is a regex source, matched
 * case-insensitively as a whole word, so `one[- ]?pot` also catches "one-pot"
 * and "onepot". See README.md in this folder for how to add a language.
 */
export interface TitleWordList {
  /** The language's own name for itself, shown in settings. */
  name: string;
  filler: string[];
  vegan: string[];
  glutenFree: string[];
}

/**
 * Built-in lists, keyed by ISO 639-1 code. A language that isn't here gets no
 * built-in cleanup, only the user's own extra words. Falling back to English
 * would strip words like "light" or "fresh" out of a French title.
 */
export const TITLE_WORD_LISTS: Record<string, TitleWordList> = {
  de,
  en,
  es,
  fr,
};
