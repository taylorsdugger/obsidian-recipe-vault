import { desc, eq, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db, schema } from "../db/client";
import { deriveRecipeFields } from "../db/recipe-row";
import type { AppBindings } from "../env";

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

  /** Editing is a raw markdown save; every derived column is recomputed. */
  .put("/:id", async (c) => {
    const body = await c.req
      .json<{ markdown?: unknown }>()
      .catch((): { markdown?: unknown } => ({}));
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    if (!markdown.trim()) {
      return c.json({ error: "The note can't be empty." }, 400);
    }

    const id = c.req.param("id");
    const updated = await db(c.env.DB)
      .update(schema.recipes)
      .set({
        markdown,
        ...deriveRecipeFields(markdown),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recipes.id, id))
      .returning();

    if (updated.length === 0) return c.json({ error: "No such recipe." }, 404);
    return c.json({ recipe: updated[0] });
  })

  .delete("/:id", async (c) => {
    const deleted = await db(c.env.DB)
      .delete(schema.recipes)
      .where(eq(schema.recipes.id, c.req.param("id")))
      .returning({ id: schema.recipes.id });

    if (deleted.length === 0) return c.json({ error: "No such recipe." }, 404);
    return c.json({ deleted: deleted[0].id });
  })

  /** "We made this tonight." Bumps the count and stamps the date. */
  .post("/:id/made", async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const updated = await db(c.env.DB)
      .update(schema.recipes)
      .set({
        timesMade: sql`${schema.recipes.timesMade} + 1`,
        lastMade: today,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recipes.id, c.req.param("id")))
      .returning({
        id: schema.recipes.id,
        timesMade: schema.recipes.timesMade,
        lastMade: schema.recipes.lastMade,
      });

    if (updated.length === 0) return c.json({ error: "No such recipe." }, 404);
    return c.json(updated[0]);
  });
