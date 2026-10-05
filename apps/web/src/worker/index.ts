import { Hono } from "hono";
import { parseRecipesFromHtml } from "@recipe-vault/core";

import { isSignedIn, requireAuth, signIn, signOut } from "./auth";
import type { AppBindings } from "./env";
import { aiRoutes } from "./routes/ai";
import { importRoutes } from "./routes/import";
import { listRoutes } from "./routes/list";
import { planRoutes } from "./routes/plan";
import { recipeRoutes } from "./routes/recipes";
import { sharedRoutes, shareRoutes } from "./routes/share";
import { settingsRoutes } from "./settings";
import { vaultRoutes } from "./routes/vault";
import { parseOptions } from "./parse-options";

/** A one-recipe page, parsed by /api/health to prove the parser still runs. */
const HEALTH_FIXTURE =
  '<!doctype html><html><head><script type="application/ld+json">' +
  '{"@type":"Recipe","name":"Soup","recipeIngredient":["water"]}' +
  "</script></head><body></body></html>";

const api = new Hono<AppBindings>()
  /**
   * Deploy check. `parser: true` means cheerio loaded and parsed under
   * `nodejs_compat` — the one real unknown in this app (see the plan, 2a).
   * Runs on a fixture string, so it makes no network call and touches no data.
   */
  .get("/health", (c) => {
    let parser = false;
    try {
      const recipes = parseRecipesFromHtml(
        HEALTH_FIXTURE,
        new URL("https://example.com/recipe"),
        parseOptions({ stripFillerWords: true, stripVeganWords: true }),
      );
      parser = recipes[0]?.name === "Soup";
    } catch {
      parser = false;
    }
    return c.json({ ok: true, parser });
  })

  /** Is the caller signed in? The client asks this on boot. */
  .get("/session", async (c) => c.json({ signedIn: await isSignedIn(c) }))

  .post("/login", async (c) => {
    const body = await c.req
      .json<{ password?: unknown }>()
      .catch((): { password?: unknown } => ({}));

    if (!(await signIn(c, body.password))) {
      return c.json({ error: "That password doesn't match." }, 401);
    }
    return c.json({ signedIn: true });
  })

  .post("/logout", (c) => {
    signOut(c);
    return c.json({ signedIn: false });
  });

// A recipe someone was sent a link to. Outside the cookie on purpose.
api.route("/shared", sharedRoutes);

// Everything past this point needs the cookie.
api.use("/recipes/*", requireAuth);
api.use("/plan/*", requireAuth);
api.use("/list/*", requireAuth);
api.use("/import/*", requireAuth);
api.use("/vault/*", requireAuth);
api.use("/settings/*", requireAuth);
api.use("/ai/*", requireAuth);

api.route("/recipes", recipeRoutes);
api.route("/recipes", shareRoutes);
api.route("/plan", planRoutes);
api.route("/list", listRoutes);
api.route("/import", importRoutes);
api.route("/vault", vaultRoutes);
api.route("/settings", settingsRoutes);
api.route("/ai", aiRoutes);

/**
 * The Worker only sees requests that didn't match a built asset. An unknown
 * /api path is a real 404; anything else is a client route (/plan, /list, a
 * deep link on a cold load), so hand back index.html and let the client
 * router sort it out.
 */
const app = new Hono<AppBindings>()
  .route("/api", api)
  .notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      return c.json({ error: "No such route." }, 404);
    }
    return c.env.ASSETS.fetch(new URL("/index.html", c.req.url));
  });

export default app;
