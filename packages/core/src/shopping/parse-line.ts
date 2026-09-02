import type { ShoppingItem } from "./types";

/**
 * Parse a shopping list line into its components.
 * e.g. "2 cups flour *(Dumplings)*" → { amount: 2, unit: "cup", name: "flour", sources: ["Dumplings"] }
 */
export function parseShoppingLine(
  text: string,
): Omit<ShoppingItem, "checked" | "original"> | null {
  if (!text.trim()) return null;

  // Replace unicode fractions with ASCII `n/d` so the numeric regex below
  // can parse them. A leading space keeps mixed numbers separate
  // ("1½" → "1 1/2"); decimals (" 0.5") must NOT be used here — the regex
  // only understands integers and `n/d`, so a decimal silently parses as 0.
  const ucFracs: [RegExp, string][] = [
    [/½/g, "1/2"],
    [/¼/g, "1/4"],
    [/¾/g, "3/4"],
    [/⅓/g, "1/3"],
    [/⅔/g, "2/3"],
    [/⅛/g, "1/8"],
    [/⅜/g, "3/8"],
    [/⅝/g, "5/8"],
    [/⅞/g, "7/8"],
  ];
  let s = text.trim();
  for (const [re, val] of ucFracs) s = s.replace(re, ` ${val}`);
  s = s.trim();

  // Normalise spaces around slashes in fractions so "1 /4" parses as "1/4"
  s = s.replace(/(\d+)\s+\/\s*(\d+)/g, "$1/$2");

  // Match a leading quantity as one token: a mixed number ("1 1/2"), a bare
  // fraction ("1/2"), or a whole number ("2"). Ordered alternation matters —
  // listing the fraction forms before the bare integer stops a fraction's
  // numerator (the "1" in "1/2") from being consumed as a standalone whole.
  const numRe = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*/;
  const numMatch = s.match(numRe);
  let amount = 0;
  let rest = s;
  if (numMatch) {
    const token = numMatch[1];
    const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    const frac = token.match(/^(\d+)\/(\d+)$/);
    if (mixed) {
      amount = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    } else if (frac) {
      amount = Number(frac[1]) / Number(frac[2]);
    } else {
      amount = parseFloat(token);
    }
    rest = s.slice(numMatch[0].length).trim();
  }

  // Try to extract a unit
  const unitMatch = rest.match(/^([a-zA-Z]+\.?)\s*/);
  let unit = "";
  let name = rest;
  if (unitMatch) {
    const normalized = normalizeIngredientUnit(unitMatch[1]);
    if (normalized) {
      unit = normalized;
      name = rest.slice(unitMatch[0].length).trim();
    }
  }

  // Extract sources annotation from end: *(Source1, Source2)*
  const srcMatch = name.match(/\s*\*\(([^)]+)\)\*\s*$/);
  let sources: string[] = [];
  if (srcMatch) {
    sources = srcMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    name = name.slice(0, name.length - srcMatch[0].length).trim();
  }

  // Strip parenthetical prep notes like "(, minced)" or "(packed)" or "(, finely diced)"
  name = name.replace(/\s*\([^)]*\)/g, "").trim();
  // Strip trailing comma-separated descriptors like ", minced" or ", or 2 pureed tomatoes"
  name = name.replace(/,.*$/, "").trim();

  return { amount, unit, name: name.toLowerCase().trim(), sources };
}

/** Normalize raw unit strings to a canonical form. Returns "" if not recognised. */
export function normalizeIngredientUnit(raw: string): string {
  const u = raw.toLowerCase().replace(/\.+$/, "");
  const map: Record<string, string> = {
    tsp: "tsp",
    t: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    tbsp: "tbsp",
    tbl: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    cup: "cup",
    cups: "cup",
    c: "cup",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilogram: "kg",
    kilograms: "kg",
    ml: "ml",
    milliliter: "ml",
    milliliters: "ml",
    millilitre: "ml",
    millilitres: "ml",
    l: "l",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    clove: "clove",
    cloves: "clove",
    slice: "slice",
    slices: "slice",
    piece: "piece",
    pieces: "piece",
    can: "can",
    cans: "can",
    package: "package",
    pkg: "package",
    packages: "package",
    bunch: "bunch",
    bunches: "bunch",
    pinch: "pinch",
    pinches: "pinch",
    sprig: "sprig",
    sprigs: "sprig",
    head: "head",
    heads: "head",
    handful: "handful",
    stalk: "stalk",
    stalks: "stalk",
  };
  return map[u] ?? "";
}
