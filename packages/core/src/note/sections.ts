/** Character offsets of one `# Heading` section inside a markdown note. */
export interface MarkdownSectionRange {
  headingEnd: number;
  bodyStart: number;
  bodyEnd: number;
}

export interface ParsedRecipeSections {
  recipeIngredient: string[];
  recipeInstructions: string[];
  ingredientRange: MarkdownSectionRange;
  instructionRange: MarkdownSectionRange;
}

/**
 * Locate a section by heading text at any level (`#` to `######`). The body
 * runs from the end of the heading line to the next heading of any level, or
 * the end of the note.
 */
export function findMarkdownSection(
  markdown: string,
  sectionTitle: string,
): MarkdownSectionRange | null {
  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRegex = new RegExp(`^#{1,6}\\s+${escapedTitle}\\s*$`, "im");
  const headingMatch = headingRegex.exec(markdown);
  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }

  const headingStart = headingMatch.index;
  const headingEnd = headingStart + headingMatch[0].length;
  const afterHeading = markdown.slice(headingEnd);
  const nextHeadingMatch = /\n#{1,6}\s+/.exec(afterHeading);
  const bodyEnd =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? headingEnd + nextHeadingMatch.index
      : markdown.length;

  return {
    headingEnd,
    bodyStart: headingEnd,
    bodyEnd,
  };
}

/**
 * Turn a section body into clean lines. Ingredient lines drop the `- [ ]`
 * checkbox; instruction lines drop `-`, `*`, or `1.` list markers.
 */
export function parseSectionList(
  sectionBody: string,
  isIngredients: boolean,
): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (isIngredients) {
        return line
          .replace(/^-\s*\[(?: |x|X)\]\s*/, "")
          .replace(/^-\s*/, "")
          .trim();
      }
      return line
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .trim();
    })
    .filter((line) => line.length > 0);
}

/** Both recipe sections, or null when either heading is missing. */
export function parseRecipeSections(
  markdown: string,
): ParsedRecipeSections | null {
  const ingredientRange = findMarkdownSection(markdown, "Ingredients");
  const instructionRange = findMarkdownSection(markdown, "Instructions");
  if (!ingredientRange || !instructionRange) {
    return null;
  }

  const recipeIngredient = parseSectionList(
    markdown.slice(ingredientRange.bodyStart, ingredientRange.bodyEnd),
    true,
  );
  const recipeInstructions = parseSectionList(
    markdown.slice(instructionRange.bodyStart, instructionRange.bodyEnd),
    false,
  );

  return {
    recipeIngredient,
    recipeInstructions,
    ingredientRange,
    instructionRange,
  };
}

/**
 * Rewrite the Ingredients and Instructions bodies in place, leaving every
 * other part of the note as it was. Throws when either section is missing.
 */
export function replaceRecipeSections(
  markdown: string,
  recipeIngredient: string[],
  recipeInstructions: string[],
): string {
  const parsed = parseRecipeSections(markdown);
  if (!parsed) {
    throw new Error(
      "Could not find both Ingredients and Instructions sections in this note.",
    );
  }

  const ingredientBody = recipeIngredient
    .map((line) => `- [ ] ${line}`)
    .join("\n");
  const instructionBody = recipeInstructions
    .map((line) => `- ${line}`)
    .join("\n");

  const replacements: Array<{ start: number; end: number; value: string }> = [
    {
      start: parsed.ingredientRange.bodyStart,
      end: parsed.ingredientRange.bodyEnd,
      value: `\n\n${ingredientBody}\n`,
    },
    {
      start: parsed.instructionRange.bodyStart,
      end: parsed.instructionRange.bodyEnd,
      value: `\n\n${instructionBody}\n`,
    },
  ].sort((a, b) => b.start - a.start);

  let nextMarkdown = markdown;
  for (const replacement of replacements) {
    nextMarkdown =
      nextMarkdown.slice(0, replacement.start) +
      replacement.value +
      nextMarkdown.slice(replacement.end);
  }

  return nextMarkdown;
}

/** Ingredient lines from a note's Ingredients section, for search indexing. */
export function ingredientsFromBody(markdown: string): string[] {
  const range = findMarkdownSection(markdown, "Ingredients");
  if (!range) return [];
  return parseSectionList(markdown.slice(range.bodyStart, range.bodyEnd), true);
}
