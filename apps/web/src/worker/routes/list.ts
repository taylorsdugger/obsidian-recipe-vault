import { Hono } from "hono";
import { removeCheckedItems } from "@recipe-vault/core/shopping/markdown";

import type { AppBindings } from "../env";
import {
  applyMerge,
  bareText,
  formatItemText,
  itemsFromLines,
  mutateList,
  readList,
  removeLine,
  setChecked,
  setText,
  withAmount,
  type ListLine,
  type ShoppingNote,
} from "../shopping-store";

/**
 * One row as the client renders it.
 *
 * The id is the item's *name*, which is also the merge key. A note has no ids
 * of its own, and a line number would break the moment Obsidian reordered the
 * file, whereas the name survives a reorder and is what the merge already
 * treats as identity. Two lines with the same name would already have merged,
 * so a collision means the cook hand-wrote a duplicate; first line wins.
 */
function toJson(line: ListLine) {
  const item = line.item;
  return {
    id: item.name,
    checked: item.checked,
    text: formatItemText(item),
    name: item.name,
    sources: item.sources,
    /**
     * What the line actually says, so the edit box opens on the cook's own
     * words. `text` is the parse rendered back out and has already lost
     * ", diced"; prefilling an editor with that would make saving a typo fix
     * delete the prep note.
     */
    raw: bareText(item.original),
    amount: item.amount,
    unit: item.unit,
  };
}

/** Find a row by the id the client sent. */
function findByName(note: ShoppingNote, id: string): ListLine | undefined {
  return note.lines.find((line) => line.item.name === id);
}

function body(note: ShoppingNote) {
  return { items: note.lines.map(toJson) };
}

export const listRoutes = new Hono<AppBindings>()
  /**
   * The whole list, read straight out of the vault note. Both phones poll this
   * every few seconds while the list screen is open (locked decision 4), so it
   * stays one R2 read and no database round trip.
   */
  .get("/", async (c) => c.json(body(await readList(c.env))))

  /**
   * Add lines. A free-text item from the list screen sends one line and no
   * source; the recipe screen sends its checked ingredients and the recipe's
   * title, which becomes the *(Source)* annotation in the note.
   */
  .post("/", async (c) => {
    const raw = await c.req
      .json<{ lines?: unknown; source?: unknown }>()
      .catch((): { lines?: unknown; source?: unknown } => ({}));

    const lines = Array.isArray(raw.lines)
      ? raw.lines.filter((l): l is string => typeof l === "string")
      : [];
    const source =
      typeof raw.source === "string" && raw.source.trim()
        ? raw.source.trim()
        : "";

    const incoming = itemsFromLines(lines, source);
    if (incoming.length === 0) {
      return c.json({ error: "Nothing to add." }, 400);
    }

    let merged = 0;
    let added = 0;
    const note = await mutateList(c.env, (current) => {
      const result = applyMerge(current, incoming);
      merged = result.merged;
      added = result.added;
      return result.markdown;
    });

    return c.json({ merged, added, ...body(note) });
  })

  /**
   * Change one item: tick it, rewrite it, or step its count.
   *
   * All three are one line edit. They share a route because they share the
   * lookup and the compare-and-swap, and only ever one of the three fields is
   * sent.
   */
  .patch("/:id", async (c) => {
    type Change = { checked?: unknown; text?: unknown; amount?: unknown };
    const raw = await c.req.json<Change>().catch((): Change => ({}));

    // Hono has already percent-decoded this. Decoding again would throw on a
    // name with a literal '%' in it - "50% cream" is a real thing to buy.
    const id = c.req.param("id");

    if (typeof raw.checked === "boolean") {
      const checked = raw.checked;
      let missing = false;

      const note = await mutateList(c.env, (current) => {
        const line = findByName(current, id);
        if (!line) {
          missing = true;
          return null;
        }
        // Already in the wanted state - the other phone tapped it too.
        if (line.item.checked === checked) return null;
        return setChecked(current.markdown, line.lineIndex, checked);
      });

      if (missing) return c.json({ error: "No such item." }, 404);

      const line = findByName(note, id);
      return c.json({ item: line ? toJson(line) : null, ...body(note) });
    }

    const text = typeof raw.text === "string" ? raw.text.trim() : null;
    // Counts are whole things. One is the floor: below it the item isn't on
    // the list any more, which is what the delete route is for.
    const count =
      typeof raw.amount === "number" && Number.isFinite(raw.amount)
        ? Math.max(1, Math.round(raw.amount))
        : null;

    if (text === null && count === null) {
      return c.json(
        { error: "Send `checked`, `text` or `amount` to change." },
        400,
      );
    }
    if (text !== null && !text) {
      return c.json({ error: "Give the item a name." }, 400);
    }

    let missing = false;
    const note = await mutateList(c.env, (current) => {
      const line = findByName(current, id);
      if (!line) {
        missing = true;
        return null;
      }
      const next = text ?? withAmount(bareText(line.item.original), count!);
      if (next === bareText(line.item.original)) return null;
      return setText(current.markdown, line.lineIndex, next);
    });

    if (missing) return c.json({ error: "No such item." }, 404);

    // The whole list, not the one row: an edit can rename the item, and the
    // name is the id, so the client has nothing left to look the row up by.
    return c.json(body(note));
  })

  /**
   * "Clear checked" at the bottom of the list. `removeCheckedItems` is core's
   * own line filter - the same one the plugin's clear command uses - so the
   * header and any unchecked line come through untouched.
   */
  .delete("/checked", async (c) => {
    let removed = 0;
    await mutateList(c.env, (current) => {
      if (!current.markdown.trim()) return null;
      const result = removeCheckedItems(current.markdown);
      removed = result.removed;
      return result.removed > 0 ? result.content : null;
    });

    return c.json({ removed });
  })

  /** Remove one item outright, for a mistyped free-text row. */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    let missing = false;

    await mutateList(c.env, (current) => {
      const line = findByName(current, id);
      if (!line) {
        missing = true;
        return null;
      }
      return removeLine(current.markdown, line.lineIndex);
    });

    if (missing) return c.json({ error: "No such item." }, 404);
    return c.json({ deleted: id });
  });
