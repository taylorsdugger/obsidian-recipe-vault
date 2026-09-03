import { Hono } from "hono";

import type { AppBindings } from "../env";

/**
 * Scaffold only. Step 2e.3 fills these in. The merge is core's
 * `mergeShoppingItems` against the current rows — no new math on this side.
 */
export const listRoutes = new Hono<AppBindings>()
  .get("/", (c) => c.json({ error: "Not implemented yet." }, 501))
  .post("/", (c) => c.json({ error: "Not implemented yet." }, 501))
  .patch("/:id", (c) => c.json({ error: "Not implemented yet." }, 501))
  .delete("/checked", (c) => c.json({ error: "Not implemented yet." }, 501));
