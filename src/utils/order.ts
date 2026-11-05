/**
 * The gallery's "Order" control: how recipes are ordered inside whatever
 * sections the current grouping (sort tab) and filters produce. "default"
 * leaves each grouping's own order alone.
 */

export type OrderField =
  | "default"
  | "created"
  | "name"
  | "cook_time"
  | "times_made";
export type OrderDir = "asc" | "desc";

export interface RecipeOrder {
  field: OrderField;
  dir: OrderDir;
}

export const DEFAULT_ORDER: RecipeOrder = { field: "default", dir: "asc" };

export const ORDER_FIELDS: readonly OrderField[] = [
  "default",
  "created",
  "name",
  "cook_time",
  "times_made",
];

export const ORDER_LABELS: Record<OrderField, string> = {
  default: "Default",
  created: "Date Added",
  name: "Name",
  cook_time: "Cook Time",
  times_made: "Times Made",
};

/** The direction a field starts in when picked: what most people want first. */
export const NATURAL_DIR: Record<OrderField, OrderDir> = {
  default: "asc",
  created: "desc",
  name: "asc",
  cook_time: "asc",
  times_made: "desc",
};

/** What the direction button says for a field, e.g. "Newest first". */
export function dirLabel(field: OrderField, dir: OrderDir): string {
  switch (field) {
    case "created":
      return dir === "desc" ? "Newest first" : "Oldest first";
    case "name":
      return dir === "asc" ? "A → Z" : "Z → A";
    case "cook_time":
      return dir === "asc" ? "Quickest first" : "Longest first";
    case "times_made":
      return dir === "desc" ? "Most made first" : "Least made first";
    default:
      return "";
  }
}

export interface OrderRecipe {
  title: string;
  cook_time_mins: number;
  times_made: number;
  created: number;
}

/**
 * Compare two recipes by the order. Unknown dates and cook times go last in
 * either direction; ties fall back to the title.
 */
export function compareRecipes(
  a: OrderRecipe,
  b: OrderRecipe,
  order: RecipeOrder,
): number {
  const byTitle = a.title.localeCompare(b.title);
  const sign = order.dir === "asc" ? 1 : -1;
  if (order.field === "name") return sign * byTitle;
  if (order.field === "default") return 0;

  const value = (r: OrderRecipe): number | null => {
    if (order.field === "created") return r.created > 0 ? r.created : null;
    if (order.field === "cook_time")
      return r.cook_time_mins > 0 ? r.cook_time_mins : null;
    return r.times_made;
  };
  const va = value(a);
  const vb = value(b);
  if (va === null || vb === null) {
    if (va === vb) return byTitle;
    return va === null ? 1 : -1;
  }
  return sign * (va - vb) || byTitle;
}

/** Section labels that stay at the end however the sections are ordered. */
const ALWAYS_LAST = new Set(["Unknown", "Uncategorized", "#"]);

/**
 * Apply the order to grouped sections.
 *
 * - Within every section, recipes follow the order.
 * - Under the Name grouping (which shows no headers) a non-name order would
 *   look random inside hidden letter sections, so it becomes one flat list.
 * - When the order's field is the grouping's own field and the direction is
 *   flipped from the grouping's natural one, the sections flip too (e.g.
 *   Recently Added + Oldest first puts the oldest month on top).
 */
export function applyOrder<T extends OrderRecipe>(
  sections: { label: string; recipes: T[] }[],
  grouping: string,
  order: RecipeOrder,
): { label: string; recipes: T[] }[] {
  if (order.field === "default") return sections;
  const cmp = (a: T, b: T) => compareRecipes(a, b, order);

  if (grouping === "name" && order.field !== "name") {
    const all = sections.flatMap((s) => s.recipes);
    return all.length ? [{ label: "", recipes: [...all].sort(cmp) }] : [];
  }

  let ordered = sections.map((s) => ({
    label: s.label,
    recipes: [...s.recipes].sort(cmp),
  }));
  if (grouping === order.field && order.dir !== NATURAL_DIR[order.field]) {
    const last = ordered.filter((s) => ALWAYS_LAST.has(s.label));
    const rest = ordered.filter((s) => !ALWAYS_LAST.has(s.label)).reverse();
    ordered = [...rest, ...last];
  }
  return ordered;
}

export function isOrderField(value: unknown): value is OrderField {
  return ORDER_FIELDS.includes(value as OrderField);
}

/** Validate a saved order, falling back to the default. */
export function sanitizeOrder(raw: unknown): RecipeOrder {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ORDER };
  const { field, dir } = raw as { field?: unknown; dir?: unknown };
  if (!isOrderField(field)) return { ...DEFAULT_ORDER };
  return {
    field,
    dir: dir === "asc" || dir === "desc" ? dir : NATURAL_DIR[field],
  };
}
