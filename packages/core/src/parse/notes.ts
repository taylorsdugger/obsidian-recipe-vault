import type * as cheerio from "cheerio";

/**
 * Flatten a schema `recipeNotes` value (string, array of strings, or array of
 * `{ text }` objects) into a deduped list of trimmed lines.
 */
export function normalizeRecipeNotes(raw: unknown): string[] {
  if (!raw) return [];

  if (typeof raw === "string") {
    const note = raw.trim();
    return note ? [note] : [];
  }

  if (!Array.isArray(raw)) return [];

  const notes = raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "text" in item) {
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text.trim() : "";
      }
      return "";
    })
    .filter((item) => item.length > 0);

  return [...new Set(notes)];
}

/**
 * Pull the notes block out of a WordPress Recipe Maker card. WPRM often leaves
 * notes out of its JSON-LD, so this reads the rendered markup instead. When the
 * URL carries a `#wprm-recipe-container-…` fragment, that card wins.
 */
export function extractWprmRecipeNotes(
  $: cheerio.CheerioAPI,
  urlHash: string,
): string[] {
  const selectorCandidates: string[] = [];
  const hashId = urlHash?.replace(/^#/, "").trim();

  if (hashId) {
    selectorCandidates.push(
      `#${hashId} .wprm-recipe-notes`,
      `#${hashId} .wprm-recipe-notes-container`,
    );
  }

  selectorCandidates.push(
    ".wprm-recipe .wprm-recipe-notes",
    ".wprm-recipe .wprm-recipe-notes-container",
    ".wprm-recipe-notes",
    ".wprm-recipe-notes-container",
  );

  for (const selector of selectorCandidates) {
    const el = $(selector).first();
    if (!el || el.length === 0) continue;

    const text = el
      .text()
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) continue;

    const cleaned = text.replace(/^notes\s*:?\s*/i, "").trim();
    if (!cleaned) continue;

    return [cleaned];
  }

  return [];
}
