import { afterEach, describe, expect, it } from "vitest";

import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
} from "./helpers/plugin";

/**
 * Recipe notes come from two places: a `recipeNotes` field in the JSON-LD
 * (normalized + deduped) or, for WordPress Recipe Maker pages that omit them
 * from schema, scraped DOM. The DOM fallback only fills in when schema has
 * none, and prefers a hash-scoped container when the URL carries one.
 */
describe("fetchRecipes — recipe notes", () => {
  afterEach(() => resetObsidianStub());

  async function parse(jsonLd: unknown, extraBody = "", url?: string) {
    respondWith(htmlWithJsonLd(jsonLd, extraBody));
    const [recipe] = await makePlugin().fetchRecipes(
      url ?? "https://example.com/recipe",
    );
    return recipe as any;
  }

  const recipe = (extra: Record<string, unknown> = {}) => ({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Notable Soup",
    recipeIngredient: ["water"],
    ...extra,
  });

  describe("normalizeRecipeNotes (from schema)", () => {
    it("wraps a single string note in an array", async () => {
      const r = await parse(recipe({ recipeNotes: "Best served hot." }));
      expect(r.recipeNotes).toEqual(["Best served hot."]);
    });

    it("flattens string + {text} objects and dedupes", async () => {
      const r = await parse(
        recipe({
          recipeNotes: [
            "Store cold.",
            "Store cold.",
            { text: "Reheat gently." },
          ],
        }),
      );
      expect(r.recipeNotes).toEqual(["Store cold.", "Reheat gently."]);
    });
  });

  describe("WPRM DOM fallback", () => {
    it("scrapes .wprm-recipe-notes when schema has no notes", async () => {
      const r = await parse(
        recipe(),
        `<div class="wprm-recipe"><div class="wprm-recipe-notes">Don't overcook the noodles.</div></div>`,
      );
      expect(r.recipeNotes).toEqual(["Don't overcook the noodles."]);
    });

    it("strips a leading 'Notes:' label", async () => {
      const r = await parse(
        recipe(),
        `<div class="wprm-recipe-notes">Notes: Add salt to taste.</div>`,
      );
      expect(r.recipeNotes).toEqual(["Add salt to taste."]);
    });

    it("prefers the container matching the URL hash", async () => {
      const r = await parse(
        recipe(),
        `<div class="wprm-recipe-notes">Wrong card.</div>` +
          `<div id="wprm-recipe-container-8103"><div class="wprm-recipe-notes">Correct card notes.</div></div>`,
        "https://example.com/recipe/#wprm-recipe-container-8103",
      );
      expect(r.recipeNotes).toEqual(["Correct card notes."]);
    });

    it("does not override notes already present in schema", async () => {
      const r = await parse(
        recipe({ recipeNotes: "From schema." }),
        `<div class="wprm-recipe-notes">From the DOM.</div>`,
      );
      expect(r.recipeNotes).toEqual(["From schema."]);
    });

    it("leaves notes empty when neither source has any", async () => {
      const r = await parse(recipe(), `<div class="other">nothing here</div>`);
      expect(r.recipeNotes).toEqual([]);
    });
  });
});
