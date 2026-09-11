import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  itemFromLine,
  mergeShoppingItems,
  type ShoppingItem,
} from "@recipe-vault/core";

import { type Db, schema } from "./client";

/** One meal on the week view. `recipe` is null for a free-text entry. */
export interface PlanEntryJson {
  id: string;
  date: string;
  slot: string;
  note: string | null;
  position: number;
  /** Reheating this recipe rather than cooking it. Never true without one. */
  leftovers: boolean;
  recipe: {
    id: string;
    title: string;
    photoUrl: string | null;
    cookTime: string | null;
  } | null;
}

/**
 * Every entry in a date range, joined to enough of its recipe to draw a card.
 * A week is at most a handful of rows, so this is one query and no N+1.
 */
export async function planEntriesInRange(
  db: Db,
  from: string,
  to: string,
): Promise<PlanEntryJson[]> {
  const rows = await db
    .select({
      id: schema.planEntries.id,
      date: schema.planEntries.date,
      slot: schema.planEntries.slot,
      note: schema.planEntries.note,
      position: schema.planEntries.position,
      leftovers: schema.planEntries.leftovers,
      recipeId: schema.recipes.id,
      title: schema.recipes.title,
      photoUrl: schema.recipes.photoUrl,
      cookTime: schema.recipes.cookTime,
    })
    .from(schema.planEntries)
    .leftJoin(
      schema.recipes,
      eq(schema.planEntries.recipeId, schema.recipes.id),
    )
    .where(
      and(gte(schema.planEntries.date, from), lte(schema.planEntries.date, to)),
    )
    .orderBy(asc(schema.planEntries.date), asc(schema.planEntries.position))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    slot: row.slot,
    note: row.note,
    position: row.position,
    // A row whose recipe was deleted falls back to a plain empty night; there
    // is nothing left to be the leftovers of.
    leftovers: row.leftovers && row.recipeId !== null,
    recipe: row.recipeId
      ? {
          id: row.recipeId,
          title: row.title ?? "Untitled recipe",
          photoUrl: row.photoUrl,
          cookTime: row.cookTime,
        }
      : null,
  }));
}

/**
 * Every ingredient from every recipe planned in a range, merged the same way
 * the shopping list merges. This is what the "shopping list for this week"
 * preview shows and what the confirm writes, so both sides see one set.
 *
 * A recipe planned twice in the week contributes its ingredients twice and
 * the amounts add up, which is right: you're cooking it twice.
 *
 * Leftovers nights are the exception and are skipped. They carry a `recipeId`
 * so the week can draw them, but you already bought those ingredients for the
 * night you cooked - counting them again would double every amount.
 */
export async function mergedPlanItems(
  db: Db,
  from: string,
  to: string,
): Promise<ShoppingItem[]> {
  const rows = await db
    .select({
      title: schema.recipes.title,
      ingredients: schema.recipes.ingredients,
    })
    .from(schema.planEntries)
    .innerJoin(
      schema.recipes,
      eq(schema.planEntries.recipeId, schema.recipes.id),
    )
    .where(
      and(
        gte(schema.planEntries.date, from),
        lte(schema.planEntries.date, to),
        eq(schema.planEntries.leftovers, false),
      ),
    )
    .orderBy(asc(schema.planEntries.date), asc(schema.planEntries.position))
    .limit(200);

  const incoming: ShoppingItem[] = [];
  for (const row of rows) {
    for (const line of linesFrom(row.ingredients)) {
      incoming.push(itemFromLine(line, row.title));
    }
  }

  // Merge into an empty list first. The result is exactly what the preview
  // renders, so unchecking a row there removes the same thing the confirm
  // would have added.
  return mergeShoppingItems([], incoming).items;
}

/** The `ingredients` column is a JSON array; a hand-edited row shouldn't throw. */
function linesFrom(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is string => typeof line === "string" && !!line.trim(),
    );
  } catch {
    return [];
  }
}
