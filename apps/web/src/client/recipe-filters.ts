import type { RecipeSummary } from "./api";

/** What "Quick" means on the gallery: on the table in half an hour. */
export const QUICK_MINUTES = 30;

/**
 * The categories the gallery filters by. A note's meal type is whatever the
 * site it came from called it, so the same thing turns up as "Main Course",
 * "Main", "Main Dish", "Entree", "Entrée" and "large plates". Each type is
 * sorted into these by keyword instead, in the order a day goes. A type can
 * land in two - "Side Dish / Appetizer" is a side and a snack - and one
 * that's about diet, like "vegan", lands in none.
 */
export const CATEGORIES = [
  { key: "breakfast", label: "Breakfast", match: /breakfast|brunch/ },
  {
    key: "mains",
    label: "Mains",
    match:
      /\bmain|entr[eé]e|dinner|lunch|large plate|one bowl|pasta|comfort food|weeknight/,
  },
  { key: "soups", label: "Soups", match: /soup|stew/ },
  { key: "salads", label: "Salads", match: /salad/ },
  { key: "sides", label: "Sides", match: /\bside/ },
  { key: "snacks", label: "Snacks", match: /snack|appetizer|starter/ },
  {
    key: "desserts",
    label: "Desserts",
    match: /dessert|cupcake|cookie|brownie|candy|cake|sweet/,
  },
  { key: "baking", label: "Baking", match: /bread|baked good|baking/ },
  {
    key: "sauces",
    label: "Sauces",
    match: /sauce|condiment|dressing|\bdip|component|paste|cheese alternative/,
  },
  { key: "drinks", label: "Drinks", match: /drink|beverage|smoothie/ },
] as const;

export type Category = (typeof CATEGORIES)[number]["key"];

/** The categories a recipe's meal types put it in. */
function categoriesOf(recipe: RecipeSummary): Set<Category> {
  const found = new Set<Category>();
  for (const part of (recipe.mealType ?? "").toLowerCase().split(",")) {
    for (const category of CATEGORIES) {
      if (category.match.test(part)) found.add(category.key);
    }
  }
  return found;
}

/** The categories a list has anything in, in the fixed order, for the chips. */
export function categoriesIn(
  recipes: RecipeSummary[],
): (typeof CATEGORIES)[number][] {
  const present = new Set<Category>();
  for (const recipe of recipes) {
    for (const key of categoriesOf(recipe)) present.add(key);
  }
  return CATEGORIES.filter((category) => present.has(category.key));
}

export interface RecipeFilters {
  /** One category, or null for all of them. */
  category: Category | null;
  quick: boolean;
}

export const NO_FILTERS: RecipeFilters = { category: null, quick: false };

export function hasFilters(filters: RecipeFilters): boolean {
  return filters.category !== null || filters.quick;
}

/**
 * The list narrowed by the chips. A recipe with no cook time isn't quick -
 * there's no telling, and the chip promises half an hour.
 */
export function applyFilters(
  recipes: RecipeSummary[],
  filters: RecipeFilters,
): RecipeSummary[] {
  return recipes.filter(
    (recipe) =>
      (!filters.category || categoriesOf(recipe).has(filters.category)) &&
      (!filters.quick ||
        (recipe.cookTimeMins !== null &&
          recipe.cookTimeMins <= QUICK_MINUTES)),
  );
}
