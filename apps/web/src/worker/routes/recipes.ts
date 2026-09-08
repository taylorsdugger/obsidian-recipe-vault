import { desc, eq, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { setFrontmatterValues } from "@recipe-vault/core/note/frontmatter";

import { db, schema } from "../db/client";
import { indexNote } from "../db/index-recipe";
import { deriveRecipeFields } from "../db/recipe-row";
import type { AppBindings } from "../env";
import { deleteNote, VaultConflict, writeNote } from "../vault-store";

/** Sort orders the recipes screen offers. Anything else falls back to recent. */
const SORTS = {
  recent: desc(schema.recipes.updatedAt),
  made: desc(schema.recipes.timesMade),
  quick: sql`CASE WHEN ${schema.recipes.cookTimeMins} IS NULL THEN 1 ELSE 0 END, ${schema.recipes.cookTimeMins} ASC`,
} as const;

type SortKey = keyof typeof SORTS;

function sortFor(raw: string | undefined) {
  return SORTS[(raw ?? "recent") as SortKey] ?? SORTS.recent;
}

export const recipeRoutes = new Hono<AppBindings>()
  /**
   * Search across title, meal type, and ingredients — the same three fields
   * the plugin's gallery filter covers. `ingredients` is a JSON array in a
   * text column, so LIKE over it is a substring match on the whole array,
   * which is exactly what the gallery does client-side today.
   */
  .get("/", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const sort = c.req.query("sort");

    const filter = q
      ? or(
          like(schema.recipes.title, `%${q}%`),
          like(schema.recipes.mealType, `%${q}%`),
          like(schema.recipes.ingredients, `%${q}%`),
        )
      : undefined;

    const rows = await db(c.env.DB)
      .select({
        id: schema.recipes.id,
        title: schema.recipes.title,
        photoUrl: schema.recipes.photoUrl,
        mealType: schema.recipes.mealType,
        cookTime: schema.recipes.cookTime,
        cookTimeMins: schema.recipes.cookTimeMins,
        timesMade: schema.recipes.timesMade,
        lastMade: schema.recipes.lastMade,
        updatedAt: schema.recipes.updatedAt,
      })
      .from(schema.recipes)
      .where(filter)
      .orderBy(sortFor(sort))
      .limit(500);

    return c.json({ recipes: rows });
  })

  .get("/:id", async (c) => {
    const [row] = await db(c.env.DB)
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, c.req.param("id")))
      .limit(1);

    if (!row) return c.json({ error: "No such recipe." }, 404);
    return c.json({ recipe: row });
  })

  /**
   * Editing is a raw markdown save. The note goes to the vault first and the
   * row is rebuilt from what landed, so R2 stays the source of truth.
   */
  .put("/:id", async (c) => {
    const body = await c.req
      .json<{ markdown?: unknown }>()
      .catch((): { markdown?: unknown } => ({}));
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    if (!markdown.trim()) {
      return c.json({ error: "The note can't be empty." }, 400);
    }

    const database = db(c.env.DB);
    const [row] = await database
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, c.req.param("id")))
      .limit(1);
    if (!row) return c.json({ error: "No such recipe." }, 404);

    try {
      await saveRecipe(c.env, database, row, markdown);
    } catch (err) {
      if (err instanceof VaultConflict) return c.json({ error: err.message }, 409);
      throw err;
    }

    const [fresh] = await database
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, row.id))
      .limit(1);
    return c.json({ recipe: fresh });
  })

  /** Deletes the note as well - the vault is the store, not a backup of it. */
  .delete("/:id", async (c) => {
    const database = db(c.env.DB);
    const [row] = await database
      .select({ id: schema.recipes.id, vaultKey: schema.recipes.vaultKey })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, c.req.param("id")))
      .limit(1);

    if (!row) return c.json({ error: "No such recipe." }, 404);

    if (row.vaultKey) await deleteNote(c.env, row.vaultKey);
    await database.delete(schema.recipes).where(eq(schema.recipes.id, row.id));

    return c.json({ deleted: row.id });
  })

  /**
   * "We made this tonight." The count lives in the note's frontmatter, the
   * same field Obsidian shows, so this rewrites the note rather than only
   * bumping a column.
   */
  .post("/:id/made", async (c) => {
    const database = db(c.env.DB);
    const [row] = await database
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, c.req.param("id")))
      .limit(1);
    if (!row) return c.json({ error: "No such recipe." }, 404);

    const today = new Date().toISOString().slice(0, 10);
    const markdown = setFrontmatterValues(row.markdown, {
      times_made: row.timesMade + 1,
      last_made: today,
    });

    try {
      await saveRecipe(c.env, database, row, markdown);
    } catch (err) {
      if (err instanceof VaultConflict) return c.json({ error: err.message }, 409);
      throw err;
    }

    return c.json({
      id: row.id,
      timesMade: row.timesMade + 1,
      lastMade: today,
    });
  });

/**
 * Save a recipe's markdown and reindex it.
 *
 * The vault is the source of truth, so the note is written there first and the
 * row is rebuilt from what landed. A row with no vault key predates the vault
 * import and has no note to write; that one updates D1 on its own.
 */
async function saveRecipe(
  env: AppBindings["Bindings"],
  database: ReturnType<typeof db>,
  row: {
    id: string;
    vaultKey: string | null;
    vaultEtag: string | null;
    photoUrl: string | null;
  },
  markdown: string,
): Promise<void> {
  if (!row.vaultKey) {
    await database
      .update(schema.recipes)
      .set({
        markdown,
        ...deriveRecipeFields(markdown),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recipes.id, row.id));
    return;
  }

  const etag = await writeNote(env, row.vaultKey, markdown, row.vaultEtag);
  await indexNote(
    database,
    { key: row.vaultKey, markdown, etag },
    row.photoUrl,
  );
}
