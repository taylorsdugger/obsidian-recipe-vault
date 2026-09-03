import { Hono } from "hono";

import type { AppBindings } from "../env";

/**
 * Scaffold only. Step 2e.2 fills these in: search across title, meal_type and
 * ingredients (mirroring the plugin gallery's filter), then the single-recipe
 * read/update/delete and the "mark made" bump.
 */
export const recipeRoutes = new Hono<AppBindings>()
  .get("/", (c) => c.json({ error: "Not implemented yet." }, 501))
  .get("/:id", (c) => c.json({ error: "Not implemented yet." }, 501))
  .put("/:id", (c) => c.json({ error: "Not implemented yet." }, 501))
  .delete("/:id", (c) => c.json({ error: "Not implemented yet." }, 501))
  .post("/:id/made", (c) => c.json({ error: "Not implemented yet." }, 501));
