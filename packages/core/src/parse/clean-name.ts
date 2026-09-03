/** The filler-word settings `cleanRecipeName` reads. */
export interface CleanNameOptions {
  /** "auto" uses the built-in list, "custom" uses `customFillerWords`. */
  fillerWordsMode: "auto" | "custom";
  /** Newline- or comma-separated words, used when the mode is "custom". */
  customFillerWords: string;
  filterVeganWords: boolean;
  filterGlutenFreeWords: boolean;
}

const BASE_FILLER_WORDS = [
  "the\\s+ultimate",
  "the\\s+best",
  "must[- ]?try",
  "one[- ]?pot",
  "one[- ]?pan",
  "restaurant[- ]?style",
  "crowd[- ]?pleasing",
  "family[- ]?favorite",
  "weeknight",
  "ultimate",
  "incredible",
  "delicious",
  "homemade",
  "awesome",
  "classic",
  "perfect",
  "amazing",
  "lighter",
  "light",
  "skinny",
  "simple",
  "tasty",
  "great",
  "quick",
  "super",
  "easy",
  "best",
  "healthy",
  "flavorful",
  "favourite",
  "favorite",
  "famous",
  "authentic",
  "copycat",
  "yummy",
  "lazy",
  "fresh",
  "comfort",
  "cozy",
  "satisfying",
  "crispy",
  "juicy",
  "sticky",
  "tender",
];

const VEGAN_WORDS = [
  "plant[- ]?based",
  "vegetarian",
  "vegan",
  "veggie",
  "meatless",
  "dairy[- ]?free",
  "df",
];

const GLUTEN_FREE_WORDS = [
  "gluten[- ]?free",
  "wheat[- ]?free",
  "flourless",
  "gf",
];

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
 * Strips common filler/marketing words and dietary labels from a recipe name.
 * e.g. "Easy Vegan Gluten-Free Dumplings" => "Dumplings"
 */
export function cleanRecipeName(
  name: string,
  opts: CleanNameOptions,
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
  let cleaned = name;
  // Run twice to catch double-encoded entities like &amp;amp;
  for (let pass = 0; pass < 2; pass++) {
    for (const [entity, char] of Object.entries(entityMap)) {
      cleaned = cleaned.split(entity).join(char);
    }
  }

  const mode = opts.fillerWordsMode ?? "auto";
  const activePatterns = new Set<string>(
    mode === "custom"
      ? getCustomFillerWordPatterns(opts.customFillerWords)
      : BASE_FILLER_WORDS,
  );

  if (opts.filterVeganWords ?? true) {
    VEGAN_WORDS.forEach((word) => activePatterns.add(word));
  }
  if (opts.filterGlutenFreeWords ?? true) {
    GLUTEN_FREE_WORDS.forEach((word) => activePatterns.add(word));
  }

  for (const word of activePatterns) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    cleaned = cleaned.replace(regex, "");
  }

  // Remove empty or whitespace-only parentheses left after keyword stripping
  cleaned = cleaned.replace(/\(\s*\)/g, "");

  // Tidy up leftover punctuation, symbols, and whitespace
  cleaned = cleaned.replace(/[\s,\-–—&|]+/g, " ").trim();

  // If the result is ALL CAPS (or mostly), convert to Title Case
  const upper = cleaned.replace(/\s/g, "");
  if (upper.length > 0 && upper === upper.toUpperCase()) {
    cleaned = cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Fall back to the original name if stripping removed everything
  return cleaned || name;
}
