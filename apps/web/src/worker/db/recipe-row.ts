import {
  cookTimeToMinutes,
  ingredientsFromBody,
  readFrontmatter,
} from "@recipe-vault/core";

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

/** Empty string means "not set" in frontmatter; collapse that to null. */
function orNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the note's title from its `# [Name](url)` heading, falling back to the
 * first heading of any kind and then to a placeholder. The template always
 * writes the linked form, but a hand-edited note may not.
 */
function titleFromMarkdown(markdown: string): string {
  const linked = markdown.match(/^#\s+\[([^\]]+)\]\([^)]*\)\s*$/m);
  if (linked) return linked[1].trim();

  const plain = markdown.match(/^#\s+(.+?)\s*$/m);
  if (plain) return plain[1].trim();

  return "Untitled recipe";
}

/**
 * Refresh every derived column from the note. Called on every write, which is
 * what lets the markdown stay the source of truth (locked decision 2) while
 * the UI still gets columns it can search and sort.
 */
export function deriveRecipeFields(markdown: string): DerivedRecipeFields {
  const fm = readFrontmatter(markdown);
  const cookTime = orNull(fm.cook_time);

  return {
    title: titleFromMarkdown(markdown),
    author: orNull(fm.author),
    sourceUrl: orNull(fm.url),
    // v1 stores remote URLs only (locked decision 7). A vault-local path from
    // an imported note would be meaningless here, so drop it.
    photoUrl: orNull(fm.photo)?.startsWith("http")
      ? (orNull(fm.photo) as string)
      : null,
    mealType: orNull(fm.meal_type),
    cookTime,
    cookTimeMins: cookTimeToMinutes(cookTime ?? undefined),
    ingredients: JSON.stringify(ingredientsFromBody(markdown)),
  };
}
