import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { RecipeFormat } from "@recipe-vault/core";

import { type Db, db, schema } from "./db/client";
import type { AppBindings } from "./env";

const RECIPE_FORMAT = "recipe_format";

/**
 * What a recipe imported in the app is saved as. Its own setting, apart from
 * the plugin's, and markdown until someone changes it.
 */
export async function getRecipeFormat(database: Db): Promise<RecipeFormat> {
  try {
    const [row] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, RECIPE_FORMAT))
      .limit(1);
    return row?.value === "cooklang" ? "cooklang" : "markdown";
  } catch (err) {
    // No settings table yet, when a deploy goes out before its migration.
    // Importing should still work, the way it did before there was a choice.
    console.error("settings: falling back to markdown", err);
    return "markdown";
  }
}

export const settingsRoutes = new Hono<AppBindings>()
  .get("/", async (c) =>
    c.json({ recipeFormat: await getRecipeFormat(db(c.env.DB)) }),
  )

  .put("/", async (c) => {
    const body = await c.req
      .json<{ recipeFormat?: unknown }>()
      .catch((): { recipeFormat?: unknown } => ({}));
    const format = body.recipeFormat;
    if (format !== "markdown" && format !== "cooklang") {
      return c.json({ error: "recipeFormat is markdown or cooklang." }, 400);
    }

    await db(c.env.DB)
      .insert(schema.settings)
      .values({ key: RECIPE_FORMAT, value: format })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: format },
      });
    return c.json({ recipeFormat: format });
  });
