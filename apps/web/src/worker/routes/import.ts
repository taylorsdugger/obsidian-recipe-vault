import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  createRecipeRenderer,
  DEFAULT_TEMPLATE,
  ensureRecipeNotesSection,
  ensureRequiredRecipeFrontmatter,
  fetchRecipes,
  normalizeRecipeNotes,
  type FetchOptions,
  type ParsedRecipe,
} from "@recipe-vault/core";

import { db, schema } from "../db/client";
import { deriveRecipeFields } from "../db/recipe-row";
import type { AppBindings } from "../env";
import { workerHttpPort } from "../http";
import { PARSE_OPTIONS } from "../parse-options";

/**
 * The web app stores remote image URLs, so `photo:` is written bare rather
 * than as the plugin's `[[wikilink]]` (locked decision 7).
 */
const renderRecipe = createRecipeRenderer(DEFAULT_TEMPLATE, {
  formatPhoto: (path) => path,
});

// Handlebars compiles lazily: `compile` hands back a function that generates
// its code on first call, via `new Function`. Workers only allows code
// generation while the module is first evaluated, so a request-time first call
// throws "Code generation from strings disallowed". Render once here, at
// startup, and every later call reuses the compiled template.
renderRecipe({});

/**
 * Render one parsed recipe to a note the same way the plugin does: template,
 * then the required-frontmatter backfill, then the notes section. Skipping
 * either of the last two would produce a note the plugin can't read back.
 */
export function recipeToMarkdown(recipe: ParsedRecipe): string {
  let md = renderRecipe({
    ...recipe,
    json: JSON.stringify(recipe, null, 2),
  });

  md = ensureRequiredRecipeFrontmatter(
    md,
    {
      cookTime:
        typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
      image: typeof recipe.image === "string" ? recipe.image : undefined,
    },
    { formatPhoto: (path) => path },
  );

  return ensureRecipeNotesSection(md, normalizeRecipeNotes(recipe.recipeNotes));
}

/**
 * `proxyFallback` is on because Worker egress comes from Cloudflare IPs, which
 * some blogs block the same way they block Obsidian mobile.
 */
const IMPORT_OPTIONS: FetchOptions = {
  ...PARSE_OPTIONS,
  proxyFallback: true,
  retryDelayMs: 500,
};

export const importRoutes = new Hono<AppBindings>()
  /**
   * Parse a URL and hand back what was found, without saving anything. The
   * client shows a preview card and posts it back to /api/import to keep it.
   */
  .post("/preview", async (c) => {
    const body = await c.req
      .json<{ url?: unknown }>()
      .catch((): { url?: unknown } => ({}));
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return c.json({ error: "Give me a recipe URL." }, 400);
    }

    try {
      const recipes = await fetchRecipes(url, workerHttpPort, IMPORT_OPTIONS);
      if (recipes.length === 0) {
        return c.json(
          { error: "No recipe data was found on that page." },
          422,
        );
      }
      return c.json({ recipes });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 502);
    }
  })

  /**
   * Keep a previewed recipe. The client posts back the `ParsedRecipe` it was
   * shown, so what gets saved is what was on screen — no second fetch, and no
   * chance the site changed in between.
   */
  .post("/", async (c) => {
    const body = await c.req
      .json<{ recipe?: unknown }>()
      .catch((): { recipe?: unknown } => ({}));

    const recipe = body.recipe;
    if (typeof recipe !== "object" || recipe === null || Array.isArray(recipe)) {
      return c.json({ error: "Send the recipe you previewed." }, 400);
    }

    const markdown = recipeToMarkdown(recipe as ParsedRecipe);
    const now = new Date().toISOString();

    const [saved] = await db(c.env.DB)
      .insert(schema.recipes)
      .values({
        id: nanoid(12),
        markdown,
        ...deriveRecipeFields(markdown),
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: schema.recipes.id,
        title: schema.recipes.title,
      });

    return c.json({ recipe: saved }, 201);
  });
