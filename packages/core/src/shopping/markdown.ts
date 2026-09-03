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

/** Render header + items back to the note format `parseShoppingListMarkdown` reads. */
export function renderShoppingListMarkdown(
  headerLines: string[],
  items: ShoppingItem[],
): string {
  const header = headerLines.length ? headerLines.join("\n") + "\n\n" : "";
  const itemLines = items.map((item) => {
    const check = item.checked ? "[x]" : "[ ]";
    const display =
      item.amount > 0 || item.unit
        ? `${formatIngredientAmount(item.amount, item.unit)} ${item.name}`
        : item.original;
    const src = item.sources.length ? ` *(${item.sources.join(", ")})*` : "";
    return `- ${check} ${display.trim()}${src}`;
  });
  return header + itemLines.join("\n") + "\n";
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
