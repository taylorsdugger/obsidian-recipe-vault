/**
 * The gallery search, split on commas. "chickpea, spinach" is two things the
 * recipe has to have, not one phrase nothing contains. A search without a
 * comma comes back as itself.
 */
export function searchTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .split(",")
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ];
}
