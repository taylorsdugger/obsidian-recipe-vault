import { parseShoppingLine } from "./parse-line";
import type { ShoppingItem } from "./types";
import { fromBaseAmount, toBaseAmount } from "./units";

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
    : {
        checked,
        amount: 0,
        unit: "",
        name: text.toLowerCase(),
        sources: [source],
        original: text,
      };
}

/**
 * Merge `incoming` items into `existing` by name. Same unit adds; compatible
 * units (volume ↔ volume, weight ↔ weight) convert through a base unit and
 * add; incompatible units append a second row. Sources are unioned onto the
 * matched row either way. Mutates and returns `existing`, so a caller holding
 * rows can write them straight back.
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
        // Incompatible units — add as separate item
        existing.push(newItem);
      }
    } else {
      match.amount += newItem.amount;
    }
    for (const src of newItem.sources) {
      if (!match.sources.includes(src)) match.sources.push(src);
    }
  }
  return { items: existing, mergedCount };
}
