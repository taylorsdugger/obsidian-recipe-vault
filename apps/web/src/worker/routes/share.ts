import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
// Deep import: the barrel pulls in cheerio, and this only needs the reader.
import { readRecipeFile } from "@recipe-vault/core/note/recipe-file";

import { db, schema } from "../db/client";
import type { RecipeRow } from "../db/schema";
import type { AppBindings } from "../env";

/**
 * What a public link shows. Built here rather than sending the note, because
 * the note's frontmatter carries times made and the last date it was cooked,
 * and the share sheet promises those stay private.
 */
export interface PublicRecipe {
  title: string;
  mealType: string | null;
  cookTime: string | null;
  author: string | null;
  sourceUrl: string | null;
  photoUrl: string | null;
  ingredients: string[];
  steps: string[];
  notes: string[];
}

/** The page's view of a row: the recipe, and nothing about the household. */
export function publicRecipe(
  row: Pick<
    RecipeRow,
    | "title"
    | "markdown"
    | "vaultKey"
    | "mealType"
    | "cookTime"
    | "author"
    | "sourceUrl"
    | "photoUrl"
  >,
): PublicRecipe {
  const file =
    readRecipeFile(row.vaultKey ?? "recipe.md", row.markdown) ??
    readRecipeFile("recipe.md", row.markdown)!;
  return {
    title: row.title,
    mealType: row.mealType,
    cookTime: row.cookTime,
    author: row.author,
    sourceUrl: row.sourceUrl,
    photoUrl: row.photoUrl,
    ingredients: file.ingredients,
    steps: file.instructions,
    notes: file.notes,
  };
}

/** Long enough that nobody finds a recipe by guessing. */
const TOKEN_LENGTH = 16;

/** Turning a recipe's link on and off. Mounted under /recipes, signed in. */
export const shareRoutes = new Hono<AppBindings>()
  .get("/:id/share", async (c) => {
    const [share] = await db(c.env.DB)
      .select({ token: schema.recipeShares.token })
      .from(schema.recipeShares)
      .where(eq(schema.recipeShares.recipeId, c.req.param("id")))
      .limit(1);
    return c.json({ token: share?.token ?? null });
  })

  /** Hands back the link that's already on rather than making a second. */
  .post("/:id/share", async (c) => {
    const database = db(c.env.DB);
    const id = c.req.param("id");

    const [recipe] = await database
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, id))
      .limit(1);
    if (!recipe) return c.json({ error: "No such recipe." }, 404);

    const token = nanoid(TOKEN_LENGTH);
    await database
      .insert(schema.recipeShares)
      .values({ token, recipeId: id, createdAt: new Date().toISOString() })
      .onConflictDoNothing({ target: schema.recipeShares.recipeId });

    // Re-read so two taps at once both come back with the one that stuck.
    const [share] = await database
      .select({ token: schema.recipeShares.token })
      .from(schema.recipeShares)
      .where(eq(schema.recipeShares.recipeId, id))
      .limit(1);
    return c.json({ token: share.token });
  })

  .delete("/:id/share", async (c) => {
    await db(c.env.DB)
      .delete(schema.recipeShares)
      .where(eq(schema.recipeShares.recipeId, c.req.param("id")));
    return c.json({ token: null });
  });

/** The public side. No cookie: the token is the permission. */
export const sharedRoutes = new Hono<AppBindings>().get(
  "/:token",
  async (c) => {
    const [row] = await db(c.env.DB)
      .select({
        title: schema.recipes.title,
        markdown: schema.recipes.markdown,
        vaultKey: schema.recipes.vaultKey,
        mealType: schema.recipes.mealType,
        cookTime: schema.recipes.cookTime,
        author: schema.recipes.author,
        sourceUrl: schema.recipes.sourceUrl,
        photoUrl: schema.recipes.photoUrl,
      })
      .from(schema.recipeShares)
      .innerJoin(
        schema.recipes,
        eq(schema.recipes.id, schema.recipeShares.recipeId),
      )
      .where(eq(schema.recipeShares.token, c.req.param("token")))
      .limit(1);

    // Turned off and never existed look the same from outside.
    if (!row) return c.json({ error: "This link is no longer active." }, 404);

    // A shared recipe isn't something to turn up in a search engine.
    c.header("X-Robots-Tag", "noindex");
    return c.json({ recipe: publicRecipe(row) });
  },
);
