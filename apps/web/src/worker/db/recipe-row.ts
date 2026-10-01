import { readRecipeFile } from "@recipe-vault/core";

/** The columns that are derived from `markdown` and never written by hand. */
export interface DerivedRecipeFields {
  title: string;
  author: string | null;
  sourceUrl: string | null;
  photoUrl: string | null;
  mealType: string | null;
  cookTime: string | null;
  cookTimeMins: number | null;
  ingredients: string;
}

/** Empty string means "not set"; collapse that to null. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Refresh every derived column from the file. Called on every write, which is
 * what lets the vault file stay the source of truth (locked decision 2) while
 * the UI still gets columns it can search and sort.
 *
 * `key` says what the text is: a `.cook` key reads as Cooklang, anything else
 * as a note. The `markdown` column holds either, as written.
 */
export function deriveRecipeFields(
  markdown: string,
  key = "recipe.md",
): DerivedRecipeFields {
  const summary =
    readRecipeFile(key, markdown) ?? readRecipeFile("recipe.md", markdown)!;
  // A note keeps "Untitled recipe" when it has no heading, rather than its
  // file name, the way it always has.
  const title =
    summary.format === "markdown" && !/^#\s+\S/m.test(markdown)
      ? "Untitled recipe"
      : summary.title;

  return {
    title,
    author: orNull(summary.author),
    sourceUrl: orNull(summary.sourceUrl),
    // v1 stores remote URLs only (locked decision 7). A vault-local path from
    // an imported note would be meaningless here, so drop it.
    photoUrl: summary.photo.startsWith("http") ? summary.photo : null,
    mealType: orNull(summary.mealType),
    cookTime: orNull(summary.cookTime),
    cookTimeMins: summary.cookTimeMins,
    ingredients: JSON.stringify(summary.ingredients),
  };
}
