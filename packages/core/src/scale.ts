import type {
  CooklangIngredient,
  CooklangRecipe,
  CooklangToken,
} from "./parse/cooklang";
import { pluraliseName, singulariseName } from "./shopping/normalize";
import { normalizeIngredientUnit } from "./shopping/parse-line";

/**
 * Scaling a recipe up or down. One factor goes over every amount: 2 for a
 * double batch, 0.5 for half.
 *
 * A markdown note's ingredients are free text, so only the amount at the
 * front of a line scales. "2 (14 oz) cans tomatoes" doubles the cans, not the
 * ounces. Steps are left alone - "bake for 25 minutes" isn't an amount of
 * anything. A `.cook` file marks its amounts, so every `@ingredient{}` scales,
 * in the list and in the steps, except one fixed with `=`.
 *
 * At 1x nothing is rewritten. The recipe reads exactly as it was written.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  "⅛": 1 / 8,
  "¼": 1 / 4,
  "⅓": 1 / 3,
  "⅜": 3 / 8,
  "½": 1 / 2,
  "⅝": 5 / 8,
  "⅔": 2 / 3,
  "¾": 3 / 4,
  "⅞": 7 / 8,
};
const UNICODE = "[⅛¼⅓⅜½⅝⅔¾⅞]";

// One amount, in the shapes recipes write them: 1 1/2, 1½, 1/2, 1.5, 2, ½.
// The mixed forms come first so "1 1/2" isn't read as a 1 with "1/2" after it.
const AMOUNT = String.raw`(?:\d+\s+\d+\s*[/⁄]\s*\d+|\d+\s*${UNICODE}|\d+\s*[/⁄]\s*\d+|\d+(?:\.\d+)?|${UNICODE})`;
const RANGE_SEPARATOR = String.raw`(?:\s*[-–—]\s*|\s+(?:to|or)\s+)`;
// An amount, or a range of two. Not followed by more of a number, so "1.5"
// is never split into a 1 and ".5".
const QUANTITY = String.raw`(${AMOUNT})(?:(${RANGE_SEPARATOR})(${AMOUNT}))?(?![\d/⁄.])`;

const LEADING_QUANTITY = new RegExp(String.raw`^(\s*)${QUANTITY}`);
const ANY_QUANTITY = new RegExp(String.raw`(^|[^\d/⁄.])${QUANTITY}`);
const ONLY_QUANTITY = new RegExp(String.raw`^\s*${QUANTITY}\s*$`);

/** A unit word right after the amount: "cups", "tbsp.", the "g" of "200g". */
const UNIT_WORD = /^(\s*)([A-Za-z]+)(\.?)(?=[\s,]|$)/;
/** "(14 oz)" or " 20-ounce", between a count and what it counts. */
const PACKAGE_SIZE =
  /^(?:\s*\([^)]*\)|\s+\d+(?:\.\d+)?\s*-?\s*[A-Za-z]+\.?(?=\s))/;

/** Units better written as decimals: "1.5 kg", not "1½ kg". */
const METRIC = new Set(["g", "kg", "ml", "l"]);

/** "1 1/2", "1½", "1.5" → 1.5. Null for anything that isn't one amount. */
export function parseQuantity(text: string): number | null {
  const s = text.trim();
  if (!new RegExp(`^${AMOUNT}$`).test(s)) return null;

  const mixed = s.match(/^(\d+)\s+(\d+)\s*[/⁄]\s*(\d+)$/);
  if (mixed) return ratio(Number(mixed[1]), Number(mixed[2]), Number(mixed[3]));
  const fraction = s.match(/^(\d+)\s*[/⁄]\s*(\d+)$/);
  if (fraction) return ratio(0, Number(fraction[1]), Number(fraction[2]));
  const unicode = s.match(new RegExp(`^(\\d*)\\s*(${UNICODE})$`));
  if (unicode) {
    return Number(unicode[1] || 0) + UNICODE_FRACTIONS[unicode[2]];
  }
  return Number(s);
}

function ratio(whole: number, top: number, bottom: number): number | null {
  return bottom === 0 ? null : whole + top / bottom;
}

const FRACTION_STEPS: [number, string][] = [
  [0, ""],
  ...Object.entries(UNICODE_FRACTIONS).map(
    ([glyph, value]): [number, string] => [value, glyph],
  ),
  [1, ""],
];

/**
 * An amount as a cook would write it. Kitchen fractions by default, rounded
 * to the nearest eighth or third: 1.5 → "1½", 0.333 → "⅓". With `decimal`,
 * a plain number with no more precision than is useful: 1.5 → "1.5",
 * 112.5 → "113".
 */
export function formatQuantity(n: number, decimal = false): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (decimal) {
    const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
    return String(Number(n.toFixed(digits)));
  }

  let whole = Math.floor(n);
  const rest = n - whole;
  let best = FRACTION_STEPS[0];
  for (const step of FRACTION_STEPS) {
    if (Math.abs(rest - step[0]) < Math.abs(rest - best[0])) best = step;
  }
  if (best[0] === 1) whole += 1;
  // Smaller than the smallest fraction worth writing. A decimal is honest.
  if (whole === 0 && !best[1]) return formatQuantity(n, true);
  if (!best[1]) return String(whole);
  return whole > 0 ? `${whole}${best[1]}` : best[1];
}

/** Whether `written` reads better as a decimal after scaling. */
function wantsDecimal(written: string, unit: string): boolean {
  return written.includes(".") || METRIC.has(normalizeIngredientUnit(unit));
}

function scaleAmount(
  written: string,
  factor: number,
  decimal: boolean,
): string {
  const n = parseQuantity(written);
  return n === null ? written : formatQuantity(n * factor, decimal);
}

/**
 * Scale an amount on its own, like a Cooklang `{2%cups}`'s "2". A range
 * scales at both ends. Anything that isn't a number ("a pinch", "some") comes
 * back as written, and so does everything at 1x.
 */
export function scaleQuantity(
  quantity: string,
  factor: number,
  unit = "",
): string {
  if (factor === 1) return quantity;
  const m = quantity.match(ONLY_QUANTITY);
  if (!m) return quantity;
  const decimal = wantsDecimal(quantity, unit);
  const low = scaleAmount(m[1], factor, decimal);
  return m[3] ? `${low}${m[2]}${scaleAmount(m[3], factor, decimal)}` : low;
}

/** The larger end of a quantity, for whether its unit wants a plural. */
function upperAmount(quantity: string): number | null {
  const m = quantity.match(ONLY_QUANTITY);
  if (!m) return null;
  return parseQuantity(m[3] ?? m[1]);
}

/** Spelled-out units and their plurals. Abbreviations don't change. */
const UNIT_PLURALS: Record<string, string> = {
  cup: "cups",
  teaspoon: "teaspoons",
  tablespoon: "tablespoons",
  ounce: "ounces",
  pound: "pounds",
  gram: "grams",
  kilogram: "kilograms",
  milliliter: "milliliters",
  millilitre: "millilitres",
  liter: "liters",
  litre: "litres",
  clove: "cloves",
  slice: "slices",
  piece: "pieces",
  can: "cans",
  package: "packages",
  bunch: "bunches",
  pinch: "pinches",
  sprig: "sprigs",
  head: "heads",
  handful: "handfuls",
  stalk: "stalks",
  stick: "sticks",
};
const UNIT_SINGULARS = Object.fromEntries(
  Object.entries(UNIT_PLURALS).map(([one, many]) => [many, one]),
);

/** Keeps the first letter's case, so "Cup" turns into "Cups". */
function matchCase(word: string, like: string): string {
  return like[0] === like[0].toUpperCase()
    ? word[0].toUpperCase() + word.slice(1)
    : word;
}

/**
 * A unit word spelled for its new amount: "1 cup" doubled is "2 cups", "2
 * cloves" halved is "1 clove". Leaves anything it doesn't know as written.
 */
export function respellUnit(unit: string, amount: number | null): string {
  if (amount === null) return unit;
  const lower = unit.toLowerCase();
  const swapped = amount > 1 ? UNIT_PLURALS[lower] : UNIT_SINGULARS[lower];
  return swapped ? matchCase(swapped, unit) : unit;
}

/**
 * The noun a count is counting, spelled for the new count: "1 onion, diced"
 * doubled is "2 onions, diced". Only the last word before any note, and only
 * a plain lowercase word, so "1 (14 oz) can" or a link is left alone.
 */
function respellNoun(rest: string, amount: number | null): string {
  if (amount === null) return rest;
  const cut = rest.search(/[,(;]|\s[-–—]\s/);
  const name = cut === -1 ? rest : rest.slice(0, cut);
  const m = name.match(/(^|\s)([a-z]+)(\s*)$/);
  if (!m || m.index === undefined) return rest;
  const word = m[2];
  const next = amount > 1 ? pluraliseName(word) : singulariseName(word);
  if (next === word) return rest;
  const at = m.index + m[1].length;
  return rest.slice(0, at) + next + rest.slice(at + word.length);
}

/**
 * Scale the amount at the front of an ingredient line, and spell its unit or
 * noun to match. "1 cup flour" doubled is "2 cups flour", "3 eggs" a third is
 * "1 egg". A line with no amount in front, like "salt to taste", is left as
 * it was.
 */
export function scaleIngredientLine(line: string, factor: number): string {
  if (factor === 1) return line;
  const m = line.match(LEADING_QUANTITY);
  if (!m) return line;

  const [whole, lead, low, separator, high] = m;
  const rest = line.slice(whole.length);

  // "1 (14 oz) can" and "2 20-ounce cans" count cans. The size between the
  // count and the unit is passed over, and doesn't scale.
  let size = rest.match(PACKAGE_SIZE)?.[0] ?? "";
  let unitMatch = rest.slice(size.length).match(UNIT_WORD);
  let unit = unitMatch ? normalizeIngredientUnit(unitMatch[2]) : "";
  if (size && !unit) {
    size = "";
    unitMatch = rest.match(UNIT_WORD);
    unit = unitMatch ? normalizeIngredientUnit(unitMatch[2]) : "";
  }
  const decimal = wantsDecimal(low + (high ?? ""), unit);

  const scaledLow = scaleAmount(low, factor, decimal);
  const scaledHigh = high ? scaleAmount(high, factor, decimal) : "";
  const amount = scaledHigh
    ? `${scaledLow}${separator}${scaledHigh}`
    : scaledLow;
  const upper = upperAmount(amount);

  if (unitMatch && unit) {
    const [unitWhole, space, word, dot] = unitMatch;
    return (
      lead +
      amount +
      size +
      space +
      respellUnit(word, upper) +
      dot +
      rest.slice(size.length + unitWhole.length)
    );
  }
  return lead + amount + respellNoun(rest, upper);
}

/**
 * The number of servings a yield says, or null when it says none. "4", "4
 * servings", "Serves 4-6" all give 4.
 */
export function servingsOf(text: string | undefined | null): number | null {
  const m = (text ?? "").match(ANY_QUANTITY);
  if (!m) return null;
  const n = parseQuantity(m[2]);
  return n !== null && n > 0 ? n : null;
}

/** "Serves 4" doubled is "Serves 8". The first number in it scales. */
export function scaleYield(text: string, factor: number): string {
  if (factor === 1) return text;
  return text.replace(ANY_QUANTITY, (whole, before: string) => {
    const quantity = whole.slice(before.length);
    return before + scaleQuantity(quantity, factor);
  });
}

/**
 * What a scaled recipe makes, for a scale control's label: "Serves 6" for a
 * bare number, the yield as written otherwise ("18 cookies"). Empty when the
 * recipe doesn't say.
 */
export function yieldLabel(
  text: string | undefined | null,
  factor: number,
): string {
  const written = (text ?? "").trim();
  if (servingsOf(written) === null) return "";
  const scaled = scaleYield(written, factor);
  return /^[\d\s./⁄¼½¾⅓⅔⅛⅜⅝⅞–—-]+$/.test(scaled)
    ? `Serves ${scaled.trim()}`
    : scaled;
}

function scaleIngredient<T extends CooklangIngredient>(
  ingredient: T,
  factor: number,
): T {
  if (ingredient.fixed || !ingredient.quantity) return ingredient;
  const quantity = scaleQuantity(ingredient.quantity, factor, ingredient.unit);
  return {
    ...ingredient,
    quantity,
    unit: respellUnit(ingredient.unit, upperAmount(quantity)),
  };
}

/**
 * A `.cook` recipe with its amounts scaled, in the ingredient list and in the
 * steps, and its servings to match. Amounts fixed with `=` stay put, and so do
 * timers and cookware: a double batch still bakes for 25 minutes in one pan.
 */
export function scaleCooklang(
  recipe: CooklangRecipe,
  factor: number,
): CooklangRecipe {
  if (factor === 1) return recipe;
  const metadata = { ...recipe.metadata };
  for (const key of ["servings", "serves"]) {
    const value = metadata[key];
    if (typeof value === "string") metadata[key] = scaleYield(value, factor);
  }
  return {
    ...recipe,
    metadata,
    ingredients: recipe.ingredients.map((i) => scaleIngredient(i, factor)),
    sections: recipe.sections.map((section) => ({
      ...section,
      steps: section.steps.map((step) => ({
        ...step,
        tokens: step.tokens.map(
          (token): CooklangToken =>
            token.type === "ingredient"
              ? scaleIngredient(token, factor)
              : token,
        ),
      })),
    })),
  };
}

/** The scales a recipe offers, smallest first. */
export const SCALE_STEPS = [0.5, 1, 1.5, 2, 3, 4] as const;

/** "½×", "1×", "1½×". */
export function scaleLabel(factor: number): string {
  return `${formatQuantity(factor)}×`;
}

/**
 * The next scale up or down from `factor`. With servings known it moves a
 * serving at a time, which is how people think about it ("two more people"),
 * and otherwise through `SCALE_STEPS`.
 */
export function stepScale(
  factor: number,
  direction: 1 | -1,
  servings: number | null = null,
): number {
  if (servings && Number.isInteger(servings)) {
    const current = Math.round(factor * servings);
    const next = Math.max(1, current + direction);
    return next / servings;
  }
  if (direction > 0) {
    return SCALE_STEPS.find((step) => step > factor + 1e-9) ?? factor;
  }
  return (
    [...SCALE_STEPS].reverse().find((step) => step < factor - 1e-9) ?? factor
  );
}
