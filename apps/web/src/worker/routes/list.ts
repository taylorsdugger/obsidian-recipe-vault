import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  formatIngredientAmount,
  itemFromLine,
  type ShoppingItem,
} from "@recipe-vault/core";

import { db, schema } from "../db/client";
import { addToList, itemFromRow, listRows } from "../db/shopping";
import type { ShoppingItemRow } from "../db/schema";
import type { AppBindings } from "../env";

/** One list row as the client renders it. */
function toJson(row: ShoppingItemRow) {
  const item = itemFromRow(row);
  return {
    id: row.id,
    checked: item.checked,
    // The same "2 1/2 cups flour" text the plugin writes into the note.
    text: formatIngredientAmount(item.amount, item.unit)
      ? `${formatIngredientAmount(item.amount, item.unit)} ${item.name}`
      : item.name,
    name: item.name,
    sources: item.sources,
    updatedAt: row.updatedAt,
  };
}

/** Read a `{ lines, source }` body into items, ignoring blank lines. */
function itemsFromBody(lines: unknown, source: unknown): ShoppingItem[] {
  if (!Array.isArray(lines)) return [];
  const from = typeof source === "string" && source.trim() ? source.trim() : "";
  return lines
    .filter((line): line is string => typeof line === "string" && !!line.trim())
    .map((line) => itemFromLine(line.trim(), from));
}

export const listRoutes = new Hono<AppBindings>()
  /**
   * The whole list. Both phones poll this every few seconds while the list
   * screen is open (locked decision 4), so it stays one cheap query.
   */
  .get("/", async (c) => {
    const rows = await listRows(db(c.env.DB));
    return c.json({ items: rows.map(toJson) });
  })

  /**
   * Add lines to the list. A free-text item from the list screen sends one
   * line and no source; the recipe screen sends its checked ingredients and
   * the recipe's title, which becomes the *(Source)* annotation.
   */
  .post("/", async (c) => {
    const body = await c.req
      .json<{ lines?: unknown; source?: unknown }>()
      .catch((): { lines?: unknown; source?: unknown } => ({}));

    const incoming = itemsFromBody(body.lines, body.source);
    if (incoming.length === 0) {
      return c.json({ error: "Nothing to add." }, 400);
    }

    const database = db(c.env.DB);
    const { merged, added } = await addToList(database, incoming);
    const rows = await listRows(database);

    return c.json({ merged, added, items: rows.map(toJson) });
  })

  /** Check or uncheck one item. The client toggles optimistically. */
  .patch("/:id", async (c) => {
    const body = await c.req
      .json<{ checked?: unknown }>()
      .catch((): { checked?: unknown } => ({}));
    if (typeof body.checked !== "boolean") {
      return c.json({ error: "Send `checked` as true or false." }, 400);
    }

    const updated = await db(c.env.DB)
      .update(schema.shoppingItems)
      .set({
        checked: body.checked ? 1 : 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.shoppingItems.id, c.req.param("id")))
      .returning();

    if (updated.length === 0) return c.json({ error: "No such item." }, 404);
    return c.json({ item: toJson(updated[0]) });
  })

  /** "Clear checked" at the bottom of the list. */
  .delete("/checked", async (c) => {
    const deleted = await db(c.env.DB)
      .delete(schema.shoppingItems)
      .where(eq(schema.shoppingItems.checked, 1))
      .returning({ id: schema.shoppingItems.id });

    return c.json({ removed: deleted.length });
  })

  /** Remove one item outright, for a mistyped free-text row. */
  .delete("/:id", async (c) => {
    const deleted = await db(c.env.DB)
      .delete(schema.shoppingItems)
      .where(eq(schema.shoppingItems.id, c.req.param("id")))
      .returning({ id: schema.shoppingItems.id });

    if (deleted.length === 0) return c.json({ error: "No such item." }, 404);
    return c.json({ deleted: deleted[0].id });
  });
