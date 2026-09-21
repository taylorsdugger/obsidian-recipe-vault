import { isPantryStaple, splitPairedName } from "./normalize";
import { parseShoppingLine } from "./parse-line";
import type { ShoppingItem } from "./types";
import { fromBaseAmount, toBaseAmount } from "./units";

/** The item a line that parsed to nothing still becomes, so it isn't dropped. */
function bareItem(
  text: string,
  source: string,
  checked: boolean,
): ShoppingItem {
  return {
    checked,
    amount: 0,
    unit: "",
    name: text.toLowerCase(),
    qualifiers: [],
    note: "",
    plural: false,
    fragment: true,
    sources: [source],
    original: text,
  };
}

/**
 * Build a `ShoppingItem` from one ingredient line. Lines that don't parse
 * (blank, or nothing recognisable) still become an item so nothing the user
 * checked is silently dropped. `source` is the recipe the line came from and
 * replaces any `*(…)*` annotation already on the line.
 */
export function itemFromLine(
  text: string,
  source: string,
  checked = false,
): ShoppingItem {
  const parsed = parseShoppingLine(text);
  return parsed
    ? { checked, ...parsed, sources: [source], original: text }
    : bareItem(text, source, checked);
}

/**
 * Build the items one *recipe* line is worth.
 *
 * Usually one, which is why `itemFromLine` exists and this doesn't replace it.
 * Two things make it more or fewer:
 *
 * - "Salt and pepper to taste" is two ingredients on one line, and it is on
 *   half the recipes in the vault. Only split when the line gave no amount, so
 *   nothing invents "1 tsp salt *and* 1 tsp pepper" out of one measurement.
 * - Water is nothing. A week of soups asks for five cups of it and none of
 *   that belongs on a list.
 * - A fragment is nothing either. Real lines from the vault: "(optional)",
 *   "(plus more as needed)", "chopped". They are what an import leaves behind
 *   when it splits a line, there is no ingredient in them to find, and a week
 *   of them is three junk rows you have to read past every shop.
 *
 * The free-text add box on the list screen goes through `itemFromLine`
 * instead: if you type "water", you want water.
 */
export function itemsFromIngredientLine(
  text: string,
  source: string,
): ShoppingItem[] {
  const item = itemFromLine(text, source);
  if (item.fragment || isPantryStaple(item.name)) return [];

  const pair = item.amount === 0 ? splitPairedName(item.name) : null;
  if (!pair) return [item];

  // `original` has to follow the split. It is what an amount-less row renders
  // as, and "Salt and pepper to taste" on both halves would put the same line
  // on the list twice.
  return pair.map((name) => ({
    ...item,
    name,
    original: name,
    qualifiers: [...item.qualifiers],
  }));
}

/** Union `from` into `into` without duplicating, preserving first-seen order. */
function addAll(into: string[], from: string[]): void {
  for (const value of from) if (!into.includes(value)) into.push(value);
}

/**
 * Merge `incoming` items into `existing` by name. Same unit adds; compatible
 * units (volume ↔ volume, weight ↔ weight) convert through a base unit and
 * add; incompatible units append a second row. Sources are unioned onto the
 * matched row either way. Mutates and returns `existing`, so a caller holding
 * rows can write them straight back.
 *
 * The name is already normalized by `parseShoppingLine`, so "1 large onion"
 * and "2 yellow onions, diced" match here and come out as one row. Their
 * qualifiers ("large", "yellow") union onto it rather than being dropped -
 * three onions on one line is only useful if you can still see that one of
 * them was red.
 *
 * `mergedCount` is how many incoming items found a name match.
 */
export function mergeShoppingItems(
  existing: ShoppingItem[],
  incoming: ShoppingItem[],
): { items: ShoppingItem[]; mergedCount: number } {
  let mergedCount = 0;
  for (const newItem of incoming) {
    const match = existing.find((e) => e.name === newItem.name);
    if (!match) {
      existing.push(newItem);
      continue;
    }
    mergedCount++;
    if (match.unit === newItem.unit && newItem.unit !== "") {
      match.amount += newItem.amount;
    } else if (
      match.unit !== newItem.unit &&
      newItem.unit !== "" &&
      match.unit !== ""
    ) {
      const matchBase = toBaseAmount(match.amount, match.unit);
      const newBase = toBaseAmount(newItem.amount, newItem.unit);
      if (matchBase && newBase && matchBase.family === newBase.family) {
        const converted = fromBaseAmount(
          matchBase.base + newBase.base,
          matchBase.family,
        );
        match.amount = converted.amount;
        match.unit = converted.unit;
      } else {
        // Incompatible units — add as separate item. The sources and
        // qualifiers below still land on the matched row as well: both rows
        // are the same ingredient, and the row you look at first should say
        // every recipe that wants it.
        existing.push(newItem);
      }
    } else {
      match.amount += newItem.amount;
    }
    addAll(match.sources, newItem.sources);
    addAll(match.qualifiers, newItem.qualifiers);
    // Prep notes stack up the same way. "diced, at room temperature" is two
    // recipes' worth of instruction on one line, which is the honest answer.
    if (newItem.note && !match.note.includes(newItem.note)) {
      match.note = match.note ? `${match.note}, ${newItem.note}` : newItem.note;
    }
  }
  return { items: existing, mergedCount };
}
