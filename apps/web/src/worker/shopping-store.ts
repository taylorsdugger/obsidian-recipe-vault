import { itemFromLine, mergeShoppingItems, type ShoppingItem } from "@recipe-vault/core";
import { parseShoppingListMarkdown } from "@recipe-vault/core/shopping/markdown";
import { formatIngredientAmount } from "@recipe-vault/core/shopping/units";

import type { Env } from "./env";

/**
 * The shopping list, stored as the vault's own note.
 *
 * Same deal as recipes (locked decision 2): R2 holds the truth and Remotely
 * Save carries it to Obsidian. The list used to live in D1 only, which meant
 * the app and the vault had two different lists.
 *
 * Every mutation here is a *line edit*, never a re-render of the whole note.
 * That matters: `parseShoppingLine` throws away prep notes, so a round trip
 * would silently rewrite "1 onion, diced" as "1 onion". Touching only the
 * lines that change leaves everything the cook typed in Obsidian alone.
 */

/** Where the sync plugin keeps it. Vault root, alongside the Recipes folder. */
export const SHOPPING_KEY = "Shopping List.md";

/**
 * How many times a write retries when the other phone got there first.
 *
 * Every mutation is a compare-and-swap on one object: read the note, edit it,
 * put it back only if the etag still matches. Concurrent writers serialise
 * through that, so the loser needs enough attempts to get a turn. Two people
 * tapping checkboxes never come close; this is sized for the pathological
 * case of several writes landing in the same instant.
 */
const WRITE_ATTEMPTS = 8;

/** Back off a little between attempts, with jitter so racers don't sync up. */
function backoff(attempt: number): Promise<void> {
  const base = 40 * 2 ** attempt;
  return new Promise((r) => setTimeout(r, base / 2 + Math.random() * base));
}

/** One line of the note, with its parsed form and where it sits in the file. */
export interface ListLine {
  /** Index into the note's lines. Not sent to the client; ids are names. */
  lineIndex: number;
  item: ShoppingItem;
}

export interface ShoppingNote {
  markdown: string;
  etag: string | null;
  lines: ListLine[];
}

const ITEM_RE = /^- \[[ xX]\]/;

/** The empty note we create the first time something is added. */
const EMPTY_NOTE = "# Shopping List\n";

/**
 * Read the note and pair each item with the line it came from.
 *
 * `parseShoppingListMarkdown` gives the items in order but not their line
 * numbers, and the line number is what the surgical edits need, so this walks
 * the file itself and parses item lines in the same order.
 */
export async function readList(env: Env): Promise<ShoppingNote> {
  const object = await env.VAULT.get(SHOPPING_KEY);
  if (!object) return { markdown: "", etag: null, lines: [] };

  const markdown = await object.text();
  return { markdown, etag: object.etag, lines: linesOf(markdown) };
}

/** Item lines of a note, in file order, each with its index. */
export function linesOf(markdown: string): ListLine[] {
  const { items } = parseShoppingListMarkdown(markdown);
  const indexes = markdown
    .split("\n")
    .map((line, i) => (ITEM_RE.test(line) ? i : -1))
    .filter((i) => i !== -1);

  // Both come from the same `- [ ]` test in the same order, so they line up.
  return items.map((item, n) => ({ lineIndex: indexes[n], item }));
}

/**
 * Read, change, write - retrying when the note moved underneath us.
 *
 * Two phones checking things off at once is the normal case here, not an
 * error, so a failed conditional write re-reads and reapplies rather than
 * surfacing a 409 the way a recipe edit does. `change` must therefore be
 * safe to run more than once.
 */
export async function mutateList(
  env: Env,
  change: (note: ShoppingNote) => string | null,
): Promise<ShoppingNote> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const note = await readList(env);
    const next = change(note);
    // Nothing to do - the change was already applied by whoever raced us.
    if (next === null) return note;

    const written = await env.VAULT.put(SHOPPING_KEY, next, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      onlyIf: note.etag
        ? { etagMatches: note.etag }
        : { etagDoesNotMatch: "*" },
    });

    if (written) {
      return { markdown: next, etag: written.etag, lines: linesOf(next) };
    }

    await backoff(attempt);
  }

  throw new Error(
    "The shopping list kept changing while we tried to save. Try again.",
  );
}

/** Flip one line's checkbox, leaving its text exactly as written. */
export function setChecked(
  markdown: string,
  lineIndex: number,
  checked: boolean,
): string {
  const lines = markdown.split("\n");
  const line = lines[lineIndex];
  if (line === undefined || !ITEM_RE.test(line)) return markdown;

  lines[lineIndex] = line.replace(
    /^- \[[ xX]\]/,
    checked ? "- [x]" : "- [ ]",
  );
  return lines.join("\n");
}

/** Drop one line outright, for a mistyped free-text row. */
export function removeLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split("\n");
  if (lines[lineIndex] === undefined) return markdown;
  lines.splice(lineIndex, 1);
  return lines.join("\n");
}

/**
 * "2 1/2 cups flour" - the same line the plugin writes into a note. The list
 * screen and the plan preview both render items this way.
 */
export function formatItemText(item: ShoppingItem): string {
  const amount = formatIngredientAmount(item.amount, item.unit);
  return amount ? `${amount} ${item.name}` : item.name;
}

/** Render one item as a note line. Only used for lines this app writes. */
export function toLine(item: ShoppingItem): string {
  const amount = formatIngredientAmount(item.amount, item.unit);
  const display = amount ? `${amount} ${item.name}` : item.original;
  const sources = item.sources.filter(Boolean);
  const annotation = sources.length ? ` *(${sources.join(", ")})*` : "";
  return `- [${item.checked ? "x" : " "}] ${display.trim()}${annotation}`;
}

/**
 * Merge incoming items into the note.
 *
 * An item that matches an existing line by name rewrites that one line with
 * the new total and the unioned sources. Anything new is appended. Every other
 * line in the file is untouched, so a header or a stray note the cook left in
 * there survives.
 */
export function applyMerge(
  note: ShoppingNote,
  incoming: ShoppingItem[],
): { markdown: string; merged: number; added: number } {
  const existing = note.lines.map((l) => ({ ...l.item, sources: [...l.item.sources] }));
  const before = existing.length;
  const { items, mergedCount } = mergeShoppingItems(existing, incoming);

  const lines = (note.markdown || EMPTY_NOTE).split("\n");

  // Rewrite the lines that changed, in place.
  for (let i = 0; i < before; i++) {
    const updated = items[i];
    const original = note.lines[i];
    const unchanged =
      updated.amount === original.item.amount &&
      updated.unit === original.item.unit &&
      updated.sources.length === original.item.sources.length;
    if (!unchanged) lines[original.lineIndex] = toLine(updated);
  }

  const appended = items.slice(before);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  for (const item of appended) lines.push(toLine(item));

  return {
    markdown: lines.join("\n") + "\n",
    merged: mergedCount,
    added: appended.length,
  };
}

/** Build items from free-text lines, the way the list screen's add box does. */
export function itemsFromLines(
  lines: string[],
  source: string,
): ShoppingItem[] {
  return lines
    .filter((line) => line.trim())
    .map((line) => itemFromLine(line.trim(), source));
}
