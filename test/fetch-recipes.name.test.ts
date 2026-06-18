import { afterEach, describe, expect, it } from "vitest";

import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
  type PluginSettingsOverride,
} from "./helpers/plugin";

/**
 * cleanRecipeName runs on every imported recipe's title. It strips marketing
 * filler words (mode-dependent), decodes HTML entities (including
 * double-encoded ones), title-cases shouty names, and falls back to the
 * original when stripping would empty it.
 */
describe("fetchRecipes — recipe name cleaning", () => {
  afterEach(() => resetObsidianStub());

  async function nameFrom(
    rawName: string,
    settings: PluginSettingsOverride = {},
  ) {
    respondWith(
      htmlWithJsonLd({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: rawName,
        recipeIngredient: ["water"],
      }),
    );
    const [recipe] = await makePlugin(settings).fetchRecipes(
      "https://example.com/recipe",
    );
    return recipe.name;
  }

  it("strips leading marketing filler words (auto mode)", async () => {
    expect(await nameFrom("The Best Chocolate Cake")).toBe("Chocolate Cake");
  });

  it("decodes a numeric entity and keeps the apostrophe", async () => {
    expect(await nameFrom("Mom&#39;s Best Cookies")).toBe("Mom's Cookies");
  });

  it("fully decodes double-encoded ampersand entities", async () => {
    // Two decode passes turn &amp;amp; into &, which the tidy step then folds
    // to a space — so the artefact never leaks into the title.
    expect(await nameFrom("Salt &amp;amp; Pepper Chicken")).toBe(
      "Salt Pepper Chicken",
    );
  });

  it("title-cases an ALL-CAPS name after stripping", async () => {
    expect(await nameFrom("EASY TACO PIE")).toBe("Taco Pie");
  });

  it("falls back to the original when every word is filler", async () => {
    expect(await nameFrom("The Best Easy Delicious")).toBe(
      "The Best Easy Delicious",
    );
  });

  it("leaves diet keywords alone when their toggle is off (default)", async () => {
    expect(await nameFrom("Vegan Tacos")).toBe("Vegan Tacos");
  });

  it("strips diet keywords when filterVeganWords is on", async () => {
    expect(await nameFrom("Vegan Tacos", { filterVeganWords: true })).toBe(
      "Tacos",
    );
  });

  it("uses only custom words in custom mode (base list ignored)", async () => {
    // "best" is a base filler word but must survive in custom mode; only the
    // configured "spicy" is removed.
    expect(
      await nameFrom("Spicy Best Ribs", {
        fillerWordsMode: "custom",
        customFillerWords: "spicy",
      }),
    ).toBe("Best Ribs");
  });
});
