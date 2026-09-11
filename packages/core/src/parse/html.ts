/**
 * Strip inline HTML tags from a schema text value and collapse whitespace.
 * Each tag becomes a space so adjacent words aren't joined. Entity decoding
 * is intentionally left to the final, settings-gated decodeHtmlEntities pass.
 */
export function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapse a doubled parenthetical: "((minced))" becomes "(minced)".
 *
 * WP Recipe Maker wraps its ingredient-notes field in parentheses when it
 * builds the JSON-LD string, so a note that already carries its own arrives
 * doubled. minimalistbaker.com publishes, verbatim, "1 medium shallot
 * ((minced))" and "1 ½ Tbsp coconut oil ((or avocado or grape seed oil // sub
 * water if avoiding oil))".
 *
 * Only a group whose entire content is one more group collapses, so a real
 * "2 (14-ounce) cans" and any genuine nesting are left alone.
 */
export function collapseDoubledParens(value: string): string {
  return value.replace(/\(\(([^()]*)\)\)/g, "($1)");
}

/**
 * Decode numeric and the handful of named HTML entities that show up in
 * recipe text. Runs over the rendered note, not the raw schema, so it is the
 * last thing to touch the text before it is written.
 */
export function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(
    /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi,
    (match, entity) => {
      const token = String(entity);

      if (token.startsWith("#x") || token.startsWith("#X")) {
        const code = Number.parseInt(token.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }

      if (token.startsWith("#")) {
        const code = Number.parseInt(token.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }

      return namedEntities[token.toLowerCase()] ?? match;
    },
  );
}
