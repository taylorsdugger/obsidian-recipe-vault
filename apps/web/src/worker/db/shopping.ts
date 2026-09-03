import { asc, eq } from "drizzle-orm";
import { mergeShoppingItems, type ShoppingItem } from "@recipe-vault/core";
import { nanoid } from "nanoid";

import { type Db, schema } from "./client";
import type { ShoppingItemRow } from "./schema";

/** A row as core sees it. The columns map one to one onto `ShoppingItem`. */
export function itemFromRow(row: ShoppingItemRow): ShoppingItem {
  let sources: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.sources);
    if (Array.isArray(parsed)) sources = parsed.filter(
      (s): s is string => typeof s === "string",
    );
  } catch {
    // A hand-edited row shouldn't take the whole list down.
    sources = [];
  }

  return {
    checked: row.checked === 1,
    amount: row.amount,
    unit: row.unit,
    name: row.name,
    sources,
    original: row.original ?? row.name,
  };
}

/** Load the whole list in display order. */
export function listRows(db: Db): Promise<ShoppingItemRow[]> {
  return db
    .select()
    .from(schema.shoppingItems)
    .orderBy(asc(schema.shoppingItems.position))
    .limit(1000);
}

/**
 * Merge new items into the list and persist the result.
 *
 * `mergeShoppingItems` mutates the array it's given: matched items are edited
 * in place and unmatched ones are appended. So the first `rows.length` results
 * still line up with the rows they came from, and anything past that is new.
 * That's what lets an existing row keep its id while its amount changes, which
 * matters because the other phone may be looking at it.
 */
export async function addToList(
  db: Db,
  incoming: ShoppingItem[],
): Promise<{ merged: number; added: number }> {
  const rows = await listRows(db);
  const existing = rows.map(itemFromRow);

  const { items, mergedCount } = mergeShoppingItems(existing, incoming);
  const now = new Date().toISOString();

  const updates = items.slice(0, rows.length).map((item, i) =>
    db
      .update(schema.shoppingItems)
      .set({
        amount: item.amount,
        unit: item.unit,
        sources: JSON.stringify(item.sources),
        updatedAt: now,
      })
      .where(eq(schema.shoppingItems.id, rows[i].id)),
  );

  const nextPosition =
    rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;

  const added = items.slice(rows.length);
  const inserts = added.map((item, i) =>
    db.insert(schema.shoppingItems).values({
      id: nanoid(12),
      name: item.name,
      amount: item.amount,
      unit: item.unit,
      checked: item.checked ? 1 : 0,
      sources: JSON.stringify(item.sources),
      original: item.original,
      position: nextPosition + i,
      updatedAt: now,
    }),
  );

  await Promise.all([...updates, ...inserts]);

  return { merged: mergedCount, added: added.length };
}
