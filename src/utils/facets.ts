/**
 * Chip filters for the gallery's non-tag sort options (Name, Meal Type,
 * Cook Time, Times Made, Recently Added). Each recipe falls into one or more values per facet; picking
 * several chips in one facet matches any of them, and facets combine with
 * each other (and with the tag filter) as "and".
 */
import {
  cookTimeGroup,
  createdGroup,
  createdGroupRank,
  timesMadeGroup,
} from "./recipeLoader";

export type FacetKey =
  | "name"
  | "meal_type"
  | "cook_time"
  | "times_made"
  | "created";
export type FacetSelections = Partial<Record<FacetKey, string[]>>;

export const FACET_KEYS: readonly FacetKey[] = [
  "name",
  "meal_type",
  "cook_time",
  "times_made",
  "created",
];

export const UNCATEGORIZED = "Uncategorized";

export const COOK_TIME_ORDER = [
  "Under 15 min",
  "15–30 min",
  "30–60 min",
  "1–2 hr",
  "2+ hr",
  "Unknown",
];

export const TIMES_MADE_ORDER = [
  "11+ times",
  "4–10 times",
  "1–3 times",
  "Never made",
];

/** A title's A–Z section: its first letter, or "#" for anything else. */
export function nameGroup(title: string): string {
  const ch = title[0]?.toUpperCase() ?? "#";
  return /^[A-Z]$/.test(ch) ? ch : "#";
}

export interface FacetRecipe {
  title: string;
  meal_type: string[];
  cook_time_mins: number;
  times_made: number;
  /** Epoch ms the recipe was added; 0 or missing if unknown. */
  created?: number;
}

export function isFacetKey(value: unknown): value is FacetKey {
  return FACET_KEYS.includes(value as FacetKey);
}

/** The values a recipe has for a facet (what its section headers would be). */
export function facetValues(recipe: FacetRecipe, key: FacetKey): string[] {
  switch (key) {
    case "name":
      return [nameGroup(recipe.title)];
    case "meal_type":
      return recipe.meal_type.length > 0 ? recipe.meal_type : [UNCATEGORIZED];
    case "cook_time":
      return [cookTimeGroup(recipe.cook_time_mins)];
    case "times_made":
      return [timesMadeGroup(recipe.times_made)];
    case "created":
      return [createdGroup(recipe.created ?? 0)];
  }
}

export function hasFacetSelection(sel: FacetSelections): boolean {
  return FACET_KEYS.some((k) => (sel[k]?.length ?? 0) > 0);
}

/** Recipes passing every facet's selection, optionally ignoring one facet. */
export function filterByFacets<T extends FacetRecipe>(
  recipes: readonly T[],
  sel: FacetSelections,
  except?: FacetKey,
): T[] {
  const active = FACET_KEYS.filter(
    (k) => k !== except && (sel[k]?.length ?? 0) > 0,
  );
  if (active.length === 0) return [...recipes];
  return recipes.filter((r) =>
    active.every((k) => facetValues(r, k).some((v) => sel[k]!.includes(v))),
  );
}

function orderValues(key: FacetKey, values: Iterable<string>): string[] {
  const list = [...new Set(values)];
  if (key === "created") {
    // Newest month first, "Unknown" last.
    return list.sort((a, b) => createdGroupRank(b) - createdGroupRank(a));
  }
  if (key === "cook_time" || key === "times_made") {
    const order = key === "cook_time" ? COOK_TIME_ORDER : TIMES_MADE_ORDER;
    const rank = (v: string) => {
      const i = order.indexOf(v);
      return i < 0 ? order.length : i;
    };
    return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }
  const last = key === "name" ? "#" : UNCATEGORIZED;
  return list.sort((a, b) => {
    if (a === last || b === last) return a === last ? 1 : -1;
    return a.localeCompare(b);
  });
}

/**
 * Chips for one facet. `all` decides which values exist (so a chip doesn't
 * vanish as other filters narrow things); `pool` gives the counts, and should
 * already be filtered by everything except this facet.
 */
export function facetChips(
  all: readonly FacetRecipe[],
  pool: readonly FacetRecipe[],
  key: FacetKey,
  selected: readonly string[] = [],
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of pool) {
    for (const v of facetValues(r, key)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const values = orderValues(key, [
    ...all.flatMap((r) => facetValues(r, key)),
    ...selected,
  ]);
  return values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
}

/** Drop unknown keys and non-string values from saved view state. */
export function sanitizeFacetSelections(raw: unknown): FacetSelections {
  const out: FacetSelections = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFacetKey(key) || !Array.isArray(value)) continue;
    const values = value.filter((v): v is string => typeof v === "string");
    if (values.length > 0) out[key] = [...new Set(values)];
  }
  return out;
}
