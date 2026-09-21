import {
  cleanPrepNote,
  liftEmbeddedUnit,
  normalizeShoppingName,
} from "./normalize";
import type { ParsedShoppingLine } from "./types";

/**
 * Parse a shopping list line into its components.
 * e.g. "2 cups flour *(Dumplings)*" → { amount: 2, unit: "cup", name: "flour", sources: ["Dumplings"] }
 */
export function parseShoppingLine(text: string): ParsedShoppingLine | null {
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

  // "2 20-ounce cans young green jackfruit" counts cans, not ounces.
  const sized = takePackageSize(rest);
  let size = sized.size;
  rest = sized.rest;

  // Try to extract a unit
  const unitMatch = rest.match(/^([a-zA-Z]+\.?)\s*/);
  let unit = "";
  let name = rest;
  if (unitMatch) {
    const canonical = normalizeIngredientUnit(unitMatch[1]);
    if (canonical) {
      unit = canonical;
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

  // Prep notes come in two shapes: parenthesised, or hung off a comma. Both
  // are set aside rather than deleted - they are the cook's own words, and
  // they used to vanish the first time a line was rewritten.
  let parens = takeParentheticals(name);

  /*
   * A parenthetical that swallowed the entire name isn't a note - the source
   * put its closing bracket in the wrong place. Real line, from the vault:
   * "1 can (15 oz. cannellini beans, drained and rinsed)", where the ")"
   * belongs after "oz.". Read the inside as the name and the row comes out as
   * "1 can cannellini beans" instead of the whole line verbatim.
   */
  if (!parens.text && parens.notes.length === 1) {
    const inner = takePackageSize(parens.notes[0]);
    if (inner.size) size = size || inner.size;
    parens = { text: inner.rest, notes: [] };
  }

  name = parens.text;
  const comma = name.match(/,\s*(.*)$/);
  if (comma) name = name.slice(0, name.length - comma[0].length).trim();

  const notes = [size, ...parens.notes, comma?.[1] ?? ""]
    .map((n) => cleanPrepNote(n))
    .filter(Boolean);

  const normalized = normalizeShoppingName(name);

  /*
   * Nothing in there named a thing to buy. Hand back the line as written
   * instead: "1/4 cup walnuts, chopped" beats a row that just says "chopped",
   * and a row you can read is a row you can fix. Treated as free text, the
   * same as a line that didn't parse at all - amount and unit go with the
   * text they came from.
   */
  if (normalized.meaningless) {
    const written = s.replace(/\s*\*\([^)]+\)\*\s*$/, "").trim();
    return {
      amount: 0,
      unit: "",
      name: written.toLowerCase(),
      qualifiers: [],
      note: "",
      plural: false,
      fragment: true,
      sources,
    };
  }

  name = normalized.key;

  // "3 garlic cloves" counts cloves the same as "4 cloves garlic" does; the
  // only difference is which side of the name the unit sat on. Same for the
  // "can" left at the front of "1 (28 oz) can crushed tomatoes".
  if (!unit) {
    const lifted = liftEmbeddedUnit(name);
    if (lifted) {
      name = lifted.name;
      unit = lifted.unit;
    }
  }

  return {
    amount,
    unit,
    name,
    qualifiers: normalized.qualifiers,
    note: notes.join(", "),
    plural: normalized.plural,
    fragment: false,
    sources,
  };
}

/**
 * Pull a leading package size off a name: the "15 oz." in "15 oz. cannellini
 * beans", or the "20-ounce" in "20-ounce cans young green jackfruit".
 *
 * A number followed by a unit and then more words is the size of the thing,
 * not the amount of it - the amount was the number before it. Reading it as
 * the unit is what turned "2 20-ounce cans jackfruit" into a row measured in
 * ounces.
 */
function takePackageSize(text: string): { size: string; rest: string } {
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*-?\s*([a-zA-Z]+\.?)\s+(?=\S)/);
  if (!match || !normalizeIngredientUnit(match[2]))
    return { size: "", rest: text };
  return {
    size: `${match[1]} ${match[2]}`.replace(/\.$/, ""),
    rest: text.slice(match[0].length).trim(),
  };
}

/**
 * Pull parenthetical prep notes off the name, handing back both halves.
 *
 * Depth is counted rather than stopping at the first `)`. WP Recipe Maker
 * publishes its ingredient-notes field already wrapped in parentheses, so a
 * note that contains its own arrives in the source's JSON-LD doubled:
 * "1 medium shallot ((minced))". A non-nesting `\([^)]*\)` matches
 * "((minced)" and strands the final ")" on the name, which is how "shallot)"
 * ended up on a shopping list.
 *
 * An unclosed "(" swallows the rest of the line. It is the start of a note the
 * source truncated, and the alternative is "flour (sifted" on the list.
 */
function takeParentheticals(text: string): { text: string; notes: string[] } {
  let out = "";
  let note = "";
  const notes: string[] = [];
  let depth = 0;

  for (const ch of text) {
    if (ch === "(") {
      depth++;
      // Only the outermost pair opens a note; "((minced))" is one note, not two.
      if (depth === 1) note = "";
    } else if (ch === ")") {
      // A closer with nothing open is stray punctuation, not an ingredient.
      if (depth > 0) {
        depth--;
        if (depth === 0 && note.trim()) notes.push(note.trim());
      }
    } else if (depth === 0) out += ch;
    else note += ch;
  }

  // An unclosed note still counts as one; the "(" ate the rest of the line.
  if (depth > 0 && note.trim()) notes.push(note.trim());

  // Removing a group from the middle leaves the spaces that surrounded it.
  return { text: out.replace(/\s{2,}/g, " ").trim(), notes };
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
    handfuls: "handful",
    stalk: "stalk",
    stalks: "stalk",
    stick: "stick",
    sticks: "stick",
  };
  return map[u] ?? "";
}
