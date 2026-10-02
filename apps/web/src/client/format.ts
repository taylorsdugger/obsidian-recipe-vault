/** Small display helpers shared by the gallery and the recipe screen. */

import type { ListItem } from "./api";
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

/**
 * Split "2 tbsp olive oil" into its amount and its name. The API sends both
 * the formatted line and the bare name, so this is a suffix trim rather than
 * a second parse. The amount reads as secondary; the thing you're looking for
 * on a shelf is the name.
 */
export function splitAmount(item: ListItem): { amount: string; name: string } {
  const name = item.name;
  if (item.text.toLowerCase().endsWith(name.toLowerCase())) {
    return {
      amount: item.text.slice(0, item.text.length - name.length).trim(),
      name: item.text.slice(item.text.length - name.length),
    };
  }
  return { amount: "", name: item.text };
}

/** "https://www.example.com/a/b" reads as "example.com". The url if it won't parse. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * "https://www.example.com/a/b/" reads as "example.com/a/b". The whole link,
 * minus the parts nobody types, for printing where a host alone isn't enough
 * to find the recipe again.
 */
export function bareUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/**
 * The PDF's file name, which browsers take from the page title. The recipe's
 * name without the characters a file system refuses, so "Mac & Cheese: Baked"
 * saves as "Mac & Cheese Baked.pdf" rather than the browser picking its own.
 */
export function pdfName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return name || "Recipe";
}

/** "Dinner · 40 min", the line under a recipe's name in the share sheet and PDF. */
export function mealAndTime(recipe: {
  mealType: string | null;
  cookTime: string | null;
}): string {
  return [spaced(recipe.mealType), recipe.cookTime ?? ""]
    .filter(Boolean)
    .join(" · ");
}
