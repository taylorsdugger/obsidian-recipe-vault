import { readFrontmatter, setFrontmatterValues } from "./note/frontmatter";
import { servingsOf, yieldLabel } from "./scale";

/**
 * A recipe's nutrition, per serving. Calories are kcal, sodium is mg, the
 * rest are grams. A missing field is one the recipe doesn't say, which is
 * different from 0.
 */
export interface Nutrition {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export type NutrientKey = keyof Nutrition;

export interface NutrientInfo {
  key: NutrientKey;
  label: string;
  unit: "" | "g" | "mg";
  /** The schema.org NutritionInformation property it comes from. */
  schema: string;
  /** Other frontmatter names a hand-written note might use for it. */
  aliases: string[];
}

/**
 * Every nutrient the app reads, in the order the details list them. The
 * `key` is the frontmatter property: a flat number, so Obsidian's properties
 * panel, Dataview and Bases can all sort and filter on it.
 */
export const NUTRIENTS: readonly NutrientInfo[] = [
  {
    key: "calories",
    label: "Calories",
    unit: "",
    schema: "calories",
    aliases: ["kcal"],
  },
  {
    key: "protein",
    label: "Protein",
    unit: "g",
    schema: "proteinContent",
    aliases: [],
  },
  {
    key: "carbs",
    label: "Carbs",
    unit: "g",
    schema: "carbohydrateContent",
    aliases: ["carbohydrates"],
  },
  { key: "fat", label: "Fat", unit: "g", schema: "fatContent", aliases: [] },
  {
    key: "fiber",
    label: "Fiber",
    unit: "g",
    schema: "fiberContent",
    aliases: ["fibre"],
  },
  {
    key: "sugar",
    label: "Sugar",
    unit: "g",
    schema: "sugarContent",
    aliases: ["sugars"],
  },
  {
    key: "sodium",
    label: "Sodium",
    unit: "mg",
    schema: "sodiumContent",
    aliases: [],
  },
];

/** The three that make up the calories, with the kcal in each gram. */
export const MACROS = [
  { key: "protein", kcal: 4 },
  { key: "carbs", kcal: 4 },
  { key: "fat", kcal: 9 },
] as const;

/** How many of the target unit one of these is. */
const TO_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  gr: 1,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  mcg: 0.000001,
  µg: 0.000001,
  ug: 0.000001,
  kg: 1000,
};

/**
 * One amount as a number in the nutrient's own unit. Takes a number as is,
 * and reads strings the way pages write them: "530 calories", "17 g",
 * "1,200 kcal", "<1 g", "0.69 g" of sodium (690 mg), "2218 kJ". Anything
 * without a number in it, or a negative one, is undefined.
 */
export function parseNutrientAmount(
  raw: unknown,
  unit: NutrientInfo["unit"],
): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const text = raw
    .trim()
    .toLowerCase()
    // A thousands comma, then a decimal one.
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d)/g, "$1.$2");
  const match = text.match(/(\d+(?:\.\d+)?|\.\d+)\s*([a-zµ]*)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const written = match[2];

  if (unit === "") {
    return written === "kj" || written === "kilojoules" ? value / 4.184 : value;
  }
  const grams = TO_GRAMS[written];
  if (grams === undefined) return value;
  // Rounded off past where it matters, so 690 mg doesn't come back as
  // 690.0000000000001 from the trip through grams.
  const converted = value * (unit === "mg" ? grams * 1000 : grams);
  return Math.round(converted * 1e6) / 1e6;
}

/** Null when there's nothing in it, so callers can test one thing. */
function orNull(nutrition: Nutrition): Nutrition | null {
  return Object.keys(nutrition).length > 0 ? nutrition : null;
}

/**
 * A recipe's schema.org `nutrition`, the NutritionInformation a page's
 * JSON-LD gives, or null when it has none. A list takes its first entry.
 */
export function nutritionFromJsonLd(value: unknown): Nutrition | null {
  const node: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof node !== "object" || node === null) return null;
  const record = node as Record<string, unknown>;
  const nutrition: Nutrition = {};
  for (const info of NUTRIENTS) {
    const amount = parseNutrientAmount(record[info.schema], info.unit);
    if (amount !== undefined) nutrition[info.key] = amount;
  }
  return orNull(nutrition);
}

/**
 * Nutrition from flat fields: a note's frontmatter, as Obsidian or
 * `readFrontmatter` hands it over, or a `.cook` file's metadata. Keys are
 * matched without regard to case.
 */
export function nutritionFromFields(
  fields: Record<string, unknown> | null | undefined,
): Nutrition | null {
  if (!fields) return null;
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(fields)) {
    lower.set(key.toLowerCase(), Array.isArray(value) ? value[0] : value);
  }
  const nutrition: Nutrition = {};
  for (const info of NUTRIENTS) {
    for (const name of [info.key, ...info.aliases]) {
      const amount = parseNutrientAmount(lower.get(name), info.unit);
      if (amount !== undefined) {
        nutrition[info.key] = amount;
        break;
      }
    }
  }
  return orNull(nutrition);
}

/** Rounded the way the frontmatter keeps it: whole numbers, or one place under 10. */
function tidy(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
}

/** The frontmatter for some nutrition, in `NUTRIENTS` order. */
export function nutritionFields(nutrition: Nutrition): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const info of NUTRIENTS) {
    const value = nutrition[info.key];
    if (value !== undefined) fields[info.key] = tidy(value);
  }
  return fields;
}

/** Back out to schema.org, for an export or a `.cook` round trip. */
export function nutritionToJsonLd(
  nutrition: Nutrition,
  servingSize = "",
): Record<string, string> {
  const node: Record<string, string> = { "@type": "NutritionInformation" };
  if (servingSize) node.servingSize = servingSize;
  for (const info of NUTRIENTS) {
    const value = nutrition[info.key];
    if (value === undefined) continue;
    node[info.schema] =
      info.unit === ""
        ? `${tidy(value)} calories`
        : `${tidy(value)} ${info.unit}`;
  }
  return node;
}

/**
 * The fields of `nutrition` that `fields` doesn't already have a value for,
 * going by the nutrient rather than the exact key, so a hand-written `kcal`
 * counts as calories. An empty `calories:` line counts as missing.
 */
export function missingNutritionFields(
  fields: Record<string, unknown>,
  nutrition: Nutrition,
): Record<string, number> {
  const existing = nutritionFromFields(fields) ?? {};
  return Object.fromEntries(
    Object.entries(nutritionFields(nutrition)).filter(
      ([key]) => existing[key as NutrientKey] === undefined,
    ),
  );
}

/**
 * Add a recipe's nutrition to a note's frontmatter. A value the note already
 * has is left as it is, so a custom template that writes these its own way
 * wins, and so does anything typed in by hand.
 */
export function ensureNutritionFrontmatter(
  markdown: string,
  nutrition: Nutrition | null,
): string {
  if (!nutrition) return markdown;
  const missing = missingNutritionFields(readFrontmatter(markdown), nutrition);
  return Object.keys(missing).length > 0
    ? setFrontmatterValues(markdown, missing)
    : markdown;
}

/** "Crispy Chickpea & Spinach Curry" → "crispychickpeaspinachcurry". */
function nameKey(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
    : "";
}

/**
 * The first of a recipe's yields, which is what a note's `servings` holds.
 * Pages give a yield as "4", 4, or ["4", "4 servings"].
 */
export function firstYield(recipeYield: unknown): string {
  const first: unknown = Array.isArray(recipeYield)
    ? (recipeYield as unknown[])[0]
    : recipeYield;
  if (typeof first === "number") return String(first);
  return typeof first === "string" ? first.trim() : "";
}

/** schema.org `servingSize` as the page wrote it: "1 of 12 fritters". */
export function servingSizeFromJsonLd(value: unknown): string {
  const node: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof node !== "object" || node === null) return "";
  const size = (node as Record<string, unknown>).servingSize;
  return typeof size === "string" ? size.replace(/\s+/g, " ").trim() : "";
}

/**
 * Whether a serving size says anything. Most food blogs put "1 serving",
 * which doesn't; "1 of 12 fritters" or "1 cup" does.
 */
export function describesServing(size: string): boolean {
  return (
    size.trim() !== "" &&
    !/^\s*(?:1|one)(?:\s*(?:serving|portion)s?)?\s*$/i.test(size)
  );
}

/** What a recipe page says about its nutrition and how much a serving is. */
export interface PageNutrition {
  nutrition: Nutrition | null;
  /** "1 of 12 fritters", "1 serving", or "". */
  servingSize: string;
  /** What the recipe makes, the way a note's `servings` keeps it. */
  servings: string;
}

/** The nutrition, serving size and yield out of one parsed recipe. */
export function recipeNutritionInfo(
  recipe: Record<string, unknown>,
): PageNutrition {
  return {
    nutrition: nutritionFromJsonLd(recipe.nutrition),
    servingSize: servingSizeFromJsonLd(recipe.nutrition),
    servings: firstYield(recipe.recipeYield),
  };
}

/**
 * The one recipe on a page that a note came from. A page can hold more than
 * one (a main and its sauce, a roundup), so the one with the note's title
 * wins. Failing that, the first one that has any nutrition. Null when
 * there's nothing to go on.
 */
export function pageNutrition(
  recipes: readonly Record<string, unknown>[],
  title: string,
): PageNutrition | null {
  const key = nameKey(title);
  const named = key
    ? recipes.find((recipe) => nameKey(recipe.name) === key)
    : undefined;
  const recipe =
    named ?? recipes.find((r) => nutritionFromJsonLd(r.nutrition) !== null);
  return recipe ? recipeNutritionInfo(recipe) : null;
}

/**
 * Of what a page says, the fields a recipe file doesn't have yet. `fields`
 * is a note's frontmatter or a `.cook` file's metadata; `cooklang` picks the
 * names, since a `.cook` file says `serving size` where a note says
 * `serving_size`. Nothing that's already there is in it.
 */
export function missingRecipeFields(
  fields: Record<string, unknown>,
  info: PageNutrition,
  cooklang = false,
): Record<string, string | number> {
  const missing: Record<string, string | number> = info.nutrition
    ? missingNutritionFields(fields, info.nutrition)
    : {};
  const has = (...keys: string[]) =>
    keys.some((key) => {
      const value = fields[key];
      return (
        typeof value === "number" ||
        (typeof value === "string" && value.trim() !== "")
      );
    });
  const sizeKey = cooklang ? "serving size" : "serving_size";
  if (info.servingSize && !has(sizeKey)) missing[sizeKey] = info.servingSize;
  if (info.servings && !has("servings", "yield", "serves")) {
    missing.servings = info.servings;
  }
  return missing;
}

/** A note with what `missingRecipeFields` says it lacks added to its frontmatter. */
export function addNoteNutrition(
  markdown: string,
  info: PageNutrition,
): string {
  const missing = missingRecipeFields(readFrontmatter(markdown), info);
  return Object.keys(missing).length > 0
    ? setFrontmatterValues(markdown, missing)
    : markdown;
}

/** Every amount times `factor`: per serving to the whole recipe, say. */
export function scaleNutrition(
  nutrition: Nutrition,
  factor: number,
): Nutrition {
  const scaled: Nutrition = {};
  for (const info of NUTRIENTS) {
    const value = nutrition[info.key];
    if (value !== undefined) scaled[info.key] = value * factor;
  }
  return scaled;
}

export interface MacroShare {
  key: (typeof MACROS)[number]["key"];
  label: string;
  /** Share of the calories that come from the macros, a whole percent. */
  percent: number;
}

/**
 * How the calories split between protein, carbs and fat, by 4, 4 and 9 kcal
 * a gram. Worked out from the grams rather than the calories line, which
 * often counts alcohol or just rounds differently. The percents add up to
 * exactly 100. Null unless all three are there: two of three would make the
 * missing one look like zero.
 */
export function macroSplit(nutrition: Nutrition): MacroShare[] | null {
  const kcal = MACROS.map((m) => {
    const grams = nutrition[m.key];
    return grams === undefined ? undefined : grams * m.kcal;
  });
  if (kcal.some((k) => k === undefined)) return null;
  const total = (kcal as number[]).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  // Largest remainder, so 33.3 / 33.3 / 33.3 comes out 34 / 33 / 33.
  const exact = (kcal as number[]).map((k) => (k / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, i) => ({ i, rest: value - floors[i] }))
    .sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return MACROS.map((m, i) => ({
    key: m.key,
    label: NUTRIENTS.find((n) => n.key === m.key)!.label,
    percent: floors[i],
  }));
}

/**
 * An amount for the screen: whole numbers from 10 up, one place below that,
 * no trailing ".0". "17 g", "690 mg", "0.5 g", and calories bare: "530".
 */
export function formatNutrient(
  value: number,
  unit: NutrientInfo["unit"],
): string {
  const n = tidy(value);
  const text = n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return unit ? `${text} ${unit}` : text;
}

/** "example-kitchen.com" for a source link, or "" if it won't parse. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface NutritionRow {
  key: NutrientKey;
  label: string;
  /** "17 g", "690 mg". */
  amount: string;
  /** Its share of the calories, for protein, carbs and fat. */
  percent: number | null;
  /** Protein, carbs or fat: the ones with a color and a place in the bar. */
  isMacro: boolean;
}

/** Everything the strip and the details draw, worked out once for both apps. */
export interface NutritionView {
  /** "530", or null when the recipe only has the breakdown. */
  calories: string | null;
  /** What the numbers are for: "per serving" or "for the whole recipe". */
  caption: string;
  /**
   * How much the recipe makes at the scale it's being made at: "serves 4",
   * "makes 12 cookies", or "" when it doesn't say.
   */
  yields: string;
  /**
   * What a serving is, in words, since "per serving" on its own doesn't say:
   * "This recipe serves 4, so a serving is a quarter of it."
   */
  servingNote: string;
  /** The end of the strip: "per serving · 1 of 12 fritters". */
  perLabel: string;
  /**
   * Whether "Whole recipe" means anything. Only with servings to multiply
   * by: without them the per-serving numbers have nothing to scale against.
   */
  canShowWhole: boolean;
  split: MacroShare[] | null;
  /** Every nutrient but calories, macros first. */
  rows: NutritionRow[];
  /** The bar as words, for a screen reader: "Calories from protein 13%, …". */
  splitLabel: string;
}

/** 4 → "a quarter". A plain fraction past four, and none for ½ a serving. */
function shareOf(count: number): string {
  if (count === 1) return "all";
  if (count === 2) return "half";
  if (count === 3) return "a third";
  if (count === 4) return "a quarter";
  return Number.isInteger(count) ? `1/${count}` : "";
}

/**
 * What a serving is and how much the recipe makes, worded for someone who
 * just sees "per serving" and wonders how big that is.
 */
function servingWords(
  servings: string,
  factor: number,
  whole: boolean,
  servingSize: string,
): { yields: string; servingNote: string; perLabel: string } {
  const words = yieldWords(servings, factor, whole);
  // The page's own serving size is the clearest answer there is.
  if (!whole && describesServing(servingSize)) {
    return {
      ...words,
      servingNote: `A serving is ${servingSize}.`,
      perLabel: `per serving · ${servingSize}`,
    };
  }
  return {
    ...words,
    perLabel: words.yields ? `per serving · ${words.yields}` : "per serving",
  };
}

function yieldWords(
  servings: string,
  factor: number,
  whole: boolean,
): { yields: string; servingNote: string } {
  const base = servingsOf(servings);
  const label = yieldLabel(servings, factor);
  if (base === null || !label) {
    return {
      yields: "",
      servingNote: whole
        ? ""
        : "The recipe doesn't say how many it serves, so there's no telling how big a serving is.",
    };
  }
  const count = base * factor;
  // "Serves 4" for a bare number, the yield as written for "12 cookies".
  // "4 servings" is a bare number too, just spelled out.
  const spelled = label.match(/^(.+?)\s+servings?$/i);
  const bare = label.startsWith("Serves ") || spelled !== null;
  const amount = spelled
    ? spelled[1]
    : bare
      ? label.slice("Serves ".length)
      : label;
  const yields = bare ? `serves ${amount}` : `makes ${amount}`;
  if (whole) {
    return {
      yields,
      servingNote: bare
        ? `All ${amount} servings together, at the scale you're making it.`
        : `All ${amount} together, at the scale you're making it.`,
    };
  }
  const share = shareOf(count);
  return {
    yields,
    servingNote:
      `This recipe ${yields}` +
      (share ? `, so a serving is ${share} of it.` : "."),
  };
}

/**
 * The nutrition as one serving, or the whole recipe at the scale it's being
 * made at. `servings` is the yield as written ("4", "12 cookies"), `factor`
 * the current scale, `servingSize` the page's own ("1 of 12 fritters"). The split is the same either way, so it's worked out
 * from the per-serving numbers.
 */
export function nutritionView(
  nutrition: Nutrition,
  servings: string,
  factor: number,
  whole: boolean,
  servingSize = "",
): NutritionView {
  const base = servingsOf(servings);
  const canShowWhole = base !== null;
  const showWhole = whole && canShowWhole;
  const shown = showWhole
    ? scaleNutrition(nutrition, base * factor)
    : nutrition;
  const split = macroSplit(nutrition);

  const rows: NutritionRow[] = [];
  for (const info of NUTRIENTS) {
    const value = shown[info.key];
    if (info.key === "calories" || value === undefined) continue;
    const share = split?.find((m) => m.key === info.key);
    rows.push({
      key: info.key,
      label: info.label,
      amount: formatNutrient(value, info.unit),
      percent: share ? share.percent : null,
      isMacro: MACROS.some((m) => m.key === info.key),
    });
  }

  return {
    calories:
      shown.calories === undefined ? null : formatNutrient(shown.calories, ""),
    caption: showWhole ? "for the whole recipe" : "per serving",
    ...servingWords(servings, factor, showWhole, servingSize),
    canShowWhole,
    split,
    rows,
    splitLabel: split
      ? "Calories from " +
        split.map((m) => `${m.label.toLowerCase()} ${m.percent}%`).join(", ")
      : "",
  };
}
