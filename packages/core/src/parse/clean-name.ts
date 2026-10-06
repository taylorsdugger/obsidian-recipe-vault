import { TITLE_WORD_LISTS } from "./title-words";

/** The title cleanup settings `cleanRecipeName` reads. */
export interface CleanNameOptions {
  /** Strip the built-in filler words for the recipe's language. */
  useBuiltInFillerWords: boolean;
  /** The user's own words, stripped in every language. Comma- or newline-separated. */
  extraFillerWords: string;
  /** Built-in words the user wants left in titles. Comma- or newline-separated. */
  keptFillerWords: string;
  filterVeganWords: boolean;
  filterGlutenFreeWords: boolean;
  /**
   * The ISO 639-1 code to use when neither the recipe nor its page says what
   * language it is in. A code with no built-in list just gets the extra words.
   */
  defaultLanguage: string;
}

/** Escape a user-typed word into a regex that also matches hyphenated forms. */
export function toLooseWordPattern(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(/\s+/g, "[-\\s]+");
}

/** Split the user's custom filler word setting into loose regex patterns. */
export function getCustomFillerWordPatterns(raw: string): string[] {
  return (raw || "")
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .map((word) => toLooseWordPattern(word));
}

/**
 * The built-in patterns for a language, minus any the user asked to keep.
 * A kept word drops every pattern that matches it whole, so keeping "one pot"
 * drops `one[- ]?pot`.
 */
function builtInPatterns(language: string, opts: CleanNameOptions): string[] {
  const list = TITLE_WORD_LISTS[language];
  if (!list) return [];
  const patterns = [
    ...(opts.useBuiltInFillerWords ?? true ? list.filler : []),
    ...(opts.filterVeganWords ?? true ? list.vegan : []),
    ...(opts.filterGlutenFreeWords ?? true ? list.glutenFree : []),
  ];
  const kept = (opts.keptFillerWords || "")
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (kept.length === 0) return patterns;
  return patterns.filter((pattern) => {
    const whole = new RegExp(`^(?:${pattern})$`, "iu");
    return !kept.some((word) => whole.test(word));
  });
}

/**
 * Strips common filler/marketing words and dietary labels from a recipe name.
 * e.g. "Easy Vegan Gluten-Free Dumplings" => "Dumplings"
 *
 * `language` is the recipe's ISO 639-1 code when the caller knows it. Without
 * one, `opts.defaultLanguage` picks the built-in list.
 */
export function cleanRecipeName(
  name: string,
  opts: CleanNameOptions,
  language?: string,
): string {
  if (!name) return name;

  // Decode common HTML entities (e.g. &amp; → &, &amp;amp; → &)
  const entityMap: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  // Compose accents so a decomposed "u + ¨" still matches "ü" in a list.
  let cleaned = name.normalize("NFC");
  // Run twice to catch double-encoded entities like &amp;amp;
  for (let pass = 0; pass < 2; pass++) {
    for (const [entity, char] of Object.entries(entityMap)) {
      cleaned = cleaned.split(entity).join(char);
    }
  }

  const activePatterns = new Set<string>([
    ...builtInPatterns(language || opts.defaultLanguage || "en", opts),
    ...getCustomFillerWordPatterns(opts.extraFillerWords),
  ]);

  // `\b` only knows ASCII letters, so it never sees a boundary before "ü" in
  // "überbacken". Check for a neighbouring letter or digit in any script.
  for (const word of activePatterns) {
    const regex = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}_])(?:${word})(?![\\p{L}\\p{M}\\p{N}_])`,
      "giu",
    );
    cleaned = cleaned.replace(regex, "");
  }

  // Drop any bracketed group that stripping left with nothing meaningful in
  // it. Matching only whitespace was not enough: "(Vegan, Gluten-Free)" leaves
  // "(, )" and "(vegan + gluten-free)" leaves "( + )", and neither is empty.
  // The test is "no letters or digits", so "(Instant Pot)" is kept.
  cleaned = cleaned.replace(/[([{][^)\]}]*[)\]}]/g, (group) =>
    /[\p{L}\p{N}]/u.test(group) ? group : "",
  );

  // Tidy up leftover punctuation, symbols, and whitespace
  cleaned = cleaned.replace(/[\s,\-–—&|]+/g, " ").trim();

  // If the result is ALL CAPS (or mostly), convert to Title Case
  const upper = cleaned.replace(/\s/g, "");
  if (upper.length > 0 && upper === upper.toUpperCase()) {
    // Capitalize the first letter of each word. Not `\b\w`, which turns
    // "ÜBERBACKEN" into "üBerbacken" and "MOM'S" into "Mom'S".
    cleaned = cleaned
      .toLowerCase()
      .replace(
        /(^|[^\p{L}\p{M}\p{N}'’])(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      );
  }

  // Fall back to the original name if stripping removed everything
  return cleaned || name;
}
