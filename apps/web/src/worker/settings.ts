import { Hono } from "hono";
import type { RecipeFormat } from "@recipe-vault/core";

import { type Db, db, schema } from "./db/client";
import type { AppBindings } from "./env";

/**
 * The app's own settings, apart from the plugin's. They live in D1 so every
 * device in the house imports the same way. The theme isn't here: that one is
 * per device, and the client keeps it.
 */
export interface AppSettings {
  /** What a recipe imported in the app is saved as. */
  recipeFormat: RecipeFormat;
  /** Drop "best", "easy", "ultimate" and the rest from an imported title. */
  stripFillerWords: boolean;
  /** Drop "vegan", "plant-based", "dairy-free" from an imported title. */
  stripVeganWords: boolean;
}

/**
 * What a fresh install gets. Both title switches start on, which is how the
 * app cleaned titles before there was a screen to turn them off.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  recipeFormat: "markdown",
  stripFillerWords: true,
  stripVeganWords: true,
};

/** The row key each setting is stored under. */
const KEYS: Record<keyof AppSettings, string> = {
  recipeFormat: "recipe_format",
  stripFillerWords: "strip_filler_words",
  stripVeganWords: "strip_vegan_words",
};

/**
 * Stored rows to settings. A missing or unreadable value falls back to its
 * default rather than failing, so a half-written table still imports.
 */
export function readSettings(stored: Map<string, string>): AppSettings {
  const flag = (key: keyof AppSettings, fallback: boolean) => {
    const value = stored.get(KEYS[key]);
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  };

  return {
    recipeFormat:
      stored.get(KEYS.recipeFormat) === "cooklang" ? "cooklang" : "markdown",
    stripFillerWords: flag("stripFillerWords", DEFAULT_SETTINGS.stripFillerWords),
    stripVeganWords: flag("stripVeganWords", DEFAULT_SETTINGS.stripVeganWords),
  };
}

export async function getSettings(database: Db): Promise<AppSettings> {
  try {
    const rows = await database.select().from(schema.settings);
    return readSettings(new Map(rows.map((row) => [row.key, row.value])));
  } catch (err) {
    // No settings table yet, when a deploy goes out before its migration.
    // Importing should still work, the way it did before there was a choice.
    console.error("settings: falling back to defaults", err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Check a PUT body. Any subset of the settings can be sent, and each one that
 * is sent has to be the right type. Unknown keys are ignored.
 */
export function parseSettingsPatch(
  body: Record<string, unknown>,
): { patch: Partial<AppSettings> } | { error: string } {
  const patch: Partial<AppSettings> = {};

  if ("recipeFormat" in body) {
    if (body.recipeFormat !== "markdown" && body.recipeFormat !== "cooklang") {
      return { error: "recipeFormat is markdown or cooklang." };
    }
    patch.recipeFormat = body.recipeFormat;
  }
  for (const key of ["stripFillerWords", "stripVeganWords"] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "boolean") {
      return { error: `${key} is true or false.` };
    }
    patch[key] = value;
  }

  if (Object.keys(patch).length === 0) {
    return { error: "Send at least one setting to change." };
  }
  return { patch };
}

export const settingsRoutes = new Hono<AppBindings>()
  .get("/", async (c) => c.json(await getSettings(db(c.env.DB))))

  .put("/", async (c) => {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const result = parseSettingsPatch(
      typeof body === "object" && body !== null ? body : {},
    );
    if ("error" in result) {
      return c.json({ error: result.error }, 400);
    }

    const database = db(c.env.DB);
    for (const [key, value] of Object.entries(result.patch)) {
      const row = { key: KEYS[key as keyof AppSettings], value: String(value) };
      await database
        .insert(schema.settings)
        .values(row)
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: row.value },
        });
    }
    return c.json(await getSettings(database));
  });
