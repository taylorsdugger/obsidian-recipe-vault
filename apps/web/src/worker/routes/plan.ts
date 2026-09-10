import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";

import { db, schema } from "../db/client";
import { mergedPlanItems, planEntriesInRange } from "../db/plan";
import { applyMerge, formatItemText, mutateList } from "../shopping-store";
import type { AppBindings } from "../env";

/** Dates are plain calendar days, written by the client in its own timezone. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One entry as `PUT /:date` accepts it. Either a recipe or a note, not both. */
interface IncomingEntry {
  recipeId: string | null;
  note: string | null;
  slot: string;
  leftovers: boolean;
}

/**
 * Read the `{ entries: [...] }` body of a day replace. Anything with neither a
 * recipe nor a note is dropped rather than stored as an empty row.
 */
function readEntries(raw: unknown): IncomingEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): IncomingEntry[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { recipeId, note, slot, leftovers } = entry as Record<
      string,
      unknown
    >;

    const id =
      typeof recipeId === "string" && recipeId.trim() ? recipeId : null;
    const text = typeof note === "string" && note.trim() ? note.trim() : null;
    if (!id && !text) return [];

    return [
      {
        // A recipe wins if a client somehow sends both, so `note` stays the
        // "no recipe for this one" field the schema describes.
        recipeId: id,
        note: id ? null : text,
        slot: typeof slot === "string" && slot.trim() ? slot.trim() : "dinner",
        // Only meaningful alongside a recipe. Flagging a free-text night would
        // leave a row that reads as leftovers and has nothing to reheat.
        leftovers: id !== null && leftovers === true,
      },
    ];
  });
}

export const planRoutes = new Hono<AppBindings>()
  /**
   * The week the client is looking at. `from` and `to` are inclusive; with
   * neither, it answers with nothing rather than the whole table.
   */
  .get("/", async (c) => {
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if (!DATE.test(from) || !DATE.test(to)) {
      return c.json({ error: "Give me `from` and `to` as YYYY-MM-DD." }, 400);
    }

    return c.json({
      entries: await planEntriesInRange(db(c.env.DB), from, to),
    });
  })

  /**
   * Replace one day. The client holds the day it's editing and sends the whole
   * thing back, which keeps adding, reordering, and clearing on one route.
   *
   * Two phones editing the same day is last-write-wins. The plan screen doesn't
   * poll, so a stale day would overwrite a fresh one — two people, one week,
   * and every mutation refetches, so this hasn't been worth locking.
   */
  .put("/:date", async (c) => {
    const date = c.req.param("date");
    if (!DATE.test(date)) {
      return c.json({ error: "That's not a YYYY-MM-DD date." }, 400);
    }

    const body = await c.req
      .json<{ entries?: unknown }>()
      .catch((): { entries?: unknown } => ({}));
    const entries = readEntries(body.entries);

    const database = db(c.env.DB);

    // A recipe deleted on the other phone would otherwise fail the foreign key
    // and 500 the whole save. Drop the missing ones and keep the rest.
    const wanted = entries
      .map((entry) => entry.recipeId)
      .filter((id): id is string => id !== null);
    const known = new Set<string>();
    if (wanted.length > 0) {
      const rows = await database
        .select({ id: schema.recipes.id })
        .from(schema.recipes)
        .where(inArray(schema.recipes.id, wanted));
      for (const row of rows) known.add(row.id);
    }
    const keep = entries.filter(
      (entry) => !entry.recipeId || known.has(entry.recipeId),
    );

    await database
      .delete(schema.planEntries)
      .where(eq(schema.planEntries.date, date));

    if (keep.length > 0) {
      await database.insert(schema.planEntries).values(
        keep.map((entry, position) => ({
          id: nanoid(12),
          date,
          slot: entry.slot,
          recipeId: entry.recipeId,
          note: entry.note,
          leftovers: entry.leftovers,
          position,
        })),
      );
    }

    return c.json({ entries: await planEntriesInRange(database, date, date) });
  })

  /** The x on one meal. Removing the last one leaves the day empty, not gone. */
  .delete("/entries/:id", async (c) => {
    const deleted = await db(c.env.DB)
      .delete(schema.planEntries)
      .where(eq(schema.planEntries.id, c.req.param("id")))
      .returning({ id: schema.planEntries.id });

    if (deleted.length === 0) return c.json({ error: "No such entry." }, 404);
    return c.json({ deleted: deleted[0].id });
  })

  /**
   * What "shopping list for this week" would add, without adding it. The
   * client shows every line checked and you uncheck what's already in the
   * pantry, so this has to be the same merged set the POST works from.
   */
  .get("/to-list", async (c) => {
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if (!DATE.test(from) || !DATE.test(to)) {
      return c.json({ error: "Give me `from` and `to` as YYYY-MM-DD." }, 400);
    }

    const items = await mergedPlanItems(db(c.env.DB), from, to);
    return c.json({
      items: items.map((item) => ({
        name: item.name,
        text: formatItemText(item),
        sources: item.sources,
      })),
    });
  })

  /**
   * Confirm the preview. `exclude` is the names that were unchecked, which is
   * the same key the merge groups on — uncheck olive oil and no recipe's olive
   * oil goes in.
   */
  .post("/to-list", async (c) => {
    const body = await c.req
      .json<{ from?: unknown; to?: unknown; exclude?: unknown }>()
      .catch((): { from?: unknown; to?: unknown; exclude?: unknown } => ({}));

    const from = typeof body.from === "string" ? body.from : "";
    const to = typeof body.to === "string" ? body.to : "";
    if (!DATE.test(from) || !DATE.test(to)) {
      return c.json({ error: "Give me `from` and `to` as YYYY-MM-DD." }, 400);
    }

    const exclude = new Set(
      Array.isArray(body.exclude)
        ? body.exclude.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
    );

    const database = db(c.env.DB);
    const items = (await mergedPlanItems(database, from, to)).filter(
      (item) => !exclude.has(item.name),
    );

    if (items.length === 0) {
      return c.json({ merged: 0, added: 0 });
    }

    // Straight into the vault note, same as any other add, so a week's shop
    // lands in Obsidian rather than in a second list only the app can see.
    let merged = 0;
    let added = 0;
    await mutateList(c.env, (current) => {
      const result = applyMerge(current, items);
      merged = result.merged;
      added = result.added;
      return result.markdown;
    });

    // Same counts the plugin reports: how many folded into a line that was
    // already on the list, and how many are new.
    return c.json({ merged, added });
  });
