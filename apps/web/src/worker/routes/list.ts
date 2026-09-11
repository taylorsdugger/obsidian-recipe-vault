import { Hono } from "hono";
import { removeCheckedItems } from "@recipe-vault/core/shopping/markdown";

import type { AppBindings } from "../env";
import {
  applyMerge,
  formatItemText,
  itemsFromLines,
  mutateList,
  readList,
  removeLine,
  setChecked,
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

  /** Check or uncheck one item. The client toggles optimistically. */
  .patch("/:id", async (c) => {
    const raw = await c.req
      .json<{ checked?: unknown }>()
      .catch((): { checked?: unknown } => ({}));
    if (typeof raw.checked !== "boolean") {
      return c.json({ error: "Send `checked` as true or false." }, 400);
    }

    // Hono has already percent-decoded this. Decoding again would throw on a
    // name with a literal '%' in it - "50% cream" is a real thing to buy.
    const id = c.req.param("id");
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
    return c.json({ item: line ? toJson(line) : null });
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
