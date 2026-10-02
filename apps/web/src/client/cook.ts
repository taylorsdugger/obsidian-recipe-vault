/**
 * Which ingredients a step uses, for cook mode's "For this step" row.
 *
 * Steps don't link to ingredients in a markdown note, so this is a guess from
 * the words. Strip the quantity and the unit off each ingredient line, then
 * look for what's left in the step, case-insensitively. When the whole name
 * isn't there, the last word of it is tried on its own: steps say "add the
 * onion", not "add the large yellow onion". A miss just leaves a chip off,
 * which is the cheap way to be wrong.
 */

/** Measures and containers. Stripped along with the number in front. */
const UNITS = [
  "cups?",
  "c",
  "tablespoons?",
  "tbsps?",
  "tbs",
  "teaspoons?",
  "tsps?",
  "ounces?",
  "oz",
  "fl\\.? oz",
  "pounds?",
  "lbs?",
  "grams?",
  "g",
  "kilograms?",
  "kg",
  "milliliters?",
  "millilitres?",
  "ml",
  "liters?",
  "litres?",
  "l",
  "pints?",
  "quarts?",
  "qts?",
  "gallons?",
  "pinch(?:es)?",
  "dash(?:es)?",
  "handfuls?",
  "cloves?",
  "cans?",
  "tins?",
  "jars?",
  "packages?",
  "packets?",
  "pkgs?",
  "sticks?",
  "slices?",
  "bunch(?:es)?",
  "heads?",
  "sprigs?",
  "stalks?",
  "pieces?",
  "knobs?",
  "bags?",
  "boxes?",
  "bottles?",
];

/**
 * Words that describe the thing rather than name it. Off the front of the
 * name, so "1 large yellow onion" reads as "yellow onion".
 */
const DESCRIPTORS = new Set([
  "large",
  "medium",
  "small",
  "big",
  "heaping",
  "level",
  "fresh",
  "freshly",
  "dried",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "grated",
  "ground",
  "crushed",
  "finely",
  "roughly",
  "thinly",
  "packed",
  "softened",
  "melted",
  "cold",
  "warm",
  "whole",
  "boneless",
  "skinless",
  "about",
  "of",
]);

// A number in any of the shapes a recipe writes one: 2, 1.5, 1/2, 1 1/2, ½,
// 1½, and ranges like 2-3 or 2 to 3.
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])`;
const QUANTITY = new RegExp(
  String.raw`^(?:${NUMBER}\s*)+(?:(?:-|–|to)\s*(?:${NUMBER}\s*)+)?`,
  "i",
);
const UNIT = new RegExp(String.raw`^(?:${UNITS.join("|")})\.?(?=\s|$)`, "i");

/**
 * The ingredient line as a chip shows it: quantity kept, the trailing prep
 * and any parenthetical dropped. "2 cans (15 oz) chickpeas, drained" comes
 * out as "2 cans chickpeas".
 */
export function chipText(line: string): string {
  return line
    .replace(/\([^)]*\)/g, " ")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim();
}

/** What's left of a line once the quantity, the unit and the adjectives go. */
export function ingredientName(line: string): string {
  let rest = chipText(line).toLowerCase();

  // Strip "2 cans" and "1 tbsp" off the front. Twice over, for the lines that
  // stack them: "1 (14 oz) can" is "1 can" by now, "2 tbsp plus 1 tsp" isn't
  // worth chasing.
  for (let i = 0; i < 2; i++) {
    rest = rest.replace(QUANTITY, "").trim();
    rest = rest.replace(UNIT, "").trim();
  }

  const words = rest.split(" ").filter((word) => word.length > 0);
  while (words.length > 1 && DESCRIPTORS.has(words[0])) words.shift();
  return words.join(" ");
}

/** "tomatoes" and "tomato" are the same thing on a counter. */
function stem(word: string): string {
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The word, or its plural, as a whole word. "oil" shouldn't match "boil". */
function mentions(text: string, word: string): boolean {
  const root = escape(stem(word));
  return new RegExp(String.raw`\b${root}(?:e?s)?\b`, "i").test(text);
}

/**
 * The ingredient lines a step mentions, in the order the recipe lists them,
 * ready to draw as chips.
 */
export function ingredientsForStep(
  step: string,
  ingredients: string[],
): string[] {
  const text = step.toLowerCase();
  const seen = new Set<string>();
  const found: string[] = [];

  for (const line of ingredients) {
    const name = ingredientName(line);
    if (name.length < 3) continue;

    const last = name.split(" ").pop() ?? name;
    const hit =
      text.includes(name) || (last.length >= 3 && mentions(text, last));
    const chip = chipText(line);
    if (hit && chip && !seen.has(chip)) {
      seen.add(chip);
      found.push(chip);
    }
  }

  return found;
}
