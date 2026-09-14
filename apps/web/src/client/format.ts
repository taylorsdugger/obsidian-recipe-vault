/** Small display helpers shared by the gallery and the recipe screen. */

import { dateKey } from "./week";

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

/**
 * Whether a recipe has already been marked made today, which is what greys the
 * button out. Nobody cooks the same thing twice in one day, and a second tap is
 * always a double tap.
 *
 * `>=` rather than `===` on purpose. Rows written before the app started
 * sending its own date were stamped in UTC, so an evening's cooking west of
 * Greenwich landed on tomorrow; those should read as done too, not as a meal
 * you can mark again.
 */
export function madeToday(lastMade: string | null): boolean {
  return !!lastMade && lastMade >= dateKey(new Date());
}
