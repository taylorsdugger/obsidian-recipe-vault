import { displayName } from "./normalize";
import { parseShoppingLine } from "./parse-line";
import type { ShoppingItem } from "./types";
import { formatIngredientAmount } from "./units";

const ITEM_RE = /^- \[[ xX]\]/;
const CHECKED_RE = /^- \[[xX]\]/;

/**
 * Read a shopping list note. Everything above the first `- [ ]` line is kept
 * verbatim as the header (title, notes, whatever the user wrote), minus
 * trailing blank lines. Non-item lines after the first item are dropped.
 */
export function parseShoppingListMarkdown(markdown: string): {
  headerLines: string[];
  items: ShoppingItem[];
} {
  const headerLines: string[] = [];
  const items: ShoppingItem[] = [];
  let foundFirstItem = false;

  for (const line of markdown.split("\n")) {
    const isItem = ITEM_RE.test(line);
    if (!isItem && !foundFirstItem) {
      headerLines.push(line);
    } else if (isItem) {
      foundFirstItem = true;
      const checked = CHECKED_RE.test(line);
      const text = line.replace(/^- \[[ xX]\]\s*/, "");
      const parsed = parseShoppingLine(text);
      items.push(
        parsed
          ? { checked, ...parsed, original: text }
          : {
              checked,
              amount: 0,
              unit: "",
              name: text.toLowerCase(),
              qualifiers: [],
              note: "",
              plural: false,
              fragment: true,
              sources: [],
              original: text,
            },
      );
    }
  }

  while (headerLines.length && !headerLines[headerLines.length - 1].trim()) {
    headerLines.pop();
  }

  return { headerLines, items };
}

/**
 * The words hanging off a row: what kind it was, and what to do with it.
 * "large, yellow, red" under three merged onions, or "diced" on the one.
 */
export function shoppingItemDetail(item: ShoppingItem): string {
  return [...item.qualifiers, item.note].filter(Boolean).join(", ");
}

/**
 * How a row reads: "3 onions", "8 cups vegetable broth", "salt".
 *
 * The name is the normalized merge key, so it comes out of storage singular.
 * `displayName` puts the plural back when the count calls for one.
 */
export function formatShoppingItemText(item: ShoppingItem): string {
  const name = displayName(item.name, item.amount, item.unit, item.plural);
  const amount = formatIngredientAmount(item.amount, item.unit);
  return amount ? `${amount} ${name}` : name;
}

/** Render header + items back to the note format `parseShoppingListMarkdown` reads. */
export function renderShoppingListMarkdown(
  headerLines: string[],
  items: ShoppingItem[],
): string {
  const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
  const itemLines = items.map((item) => toShoppingLine(item));
  return header + itemLines.join("\n") + "\n";
}

/**
 * One item as a note line.
 *
 * The detail goes in plain parentheses and the sources in the `*(…)*` the
 * parser already looks for, which keeps them apart on the way back in: a
 * plain parenthetical reads as a prep note, the starred one as provenance.
 */
export function toShoppingLine(item: ShoppingItem): string {
  const check = item.checked ? "[x]" : "[ ]";
  // A line with no amount and no unit is something the cook typed - "salt to
  // taste", "something for dessert". It goes back exactly as written, because
  // rendering it would hand back the normalized name and quietly drop the
  // rest of the sentence.
  const body =
    item.amount > 0 || item.unit ? formatShoppingItemText(item) : item.original;
  const detail = shoppingItemDetail(item);
  const src = item.sources.filter(Boolean);
  return [
    `- ${check} ${body.trim()}`,
    detail ? ` (${detail})` : "",
    src.length ? ` *(${src.join(", ")})*` : "",
  ].join("");
}

/**
 * Drop every checked line from a shopping list note, leaving all other lines
 * untouched. Returns the new content and how many lines were removed.
 */
export function removeCheckedItems(markdown: string): {
  content: string;
  removed: number;
} {
  const lines = markdown.split("\n");
  const removed = lines.filter((line) => CHECKED_RE.test(line)).length;
  const kept = lines.filter((line) => !CHECKED_RE.test(line));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return { content: kept.join("\n") + "\n", removed };
}
