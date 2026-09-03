import { Hono } from "hono";

import type { AppBindings } from "../env";

/**
 * Scaffold only. Step 2e.4 fills these in, including `to-list`, which gathers
 * ingredients across a date range and merges them into the shopping list.
 */
export const planRoutes = new Hono<AppBindings>()
  .get("/", (c) => c.json({ error: "Not implemented yet." }, 501))
  .put("/:date", (c) => c.json({ error: "Not implemented yet." }, 501))
  .delete("/entries/:id", (c) => c.json({ error: "Not implemented yet." }, 501))
  .post("/to-list", (c) => c.json({ error: "Not implemented yet." }, 501));
