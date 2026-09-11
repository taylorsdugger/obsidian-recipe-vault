/** Small display helpers shared by the gallery and the recipe screen. */

/** "2026-07-15" reads as "15 Jul" once you already know the year. */
export function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Comma strings out of frontmatter read better with spaces. */
export function spaced(value: string | null): string {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/** "Made 3 · 27 May", kept to one line so a grid of cards stays even. */
export function madeSummary(
  timesMade: number,
  lastMade: string | null,
): string | null {
  if (timesMade <= 0) return null;
  return `Made ${timesMade}${lastMade ? ` · ${shortDate(lastMade)}` : ""}`;
}
