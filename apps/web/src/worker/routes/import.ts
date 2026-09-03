import { Hono } from "hono";
import { fetchRecipes, type FetchOptions } from "@recipe-vault/core";

import type { AppBindings } from "../env";
import { workerHttpPort } from "../http";
import { PARSE_OPTIONS } from "../parse-options";

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

  // TODO(step 2e.2): render with createRecipeRenderer(DEFAULT_TEMPLATE) and
  // insert, refreshing the derived columns from the markdown.
  .post("/", (c) => c.json({ error: "Not implemented yet." }, 501));
