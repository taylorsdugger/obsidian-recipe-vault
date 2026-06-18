import { afterEach, describe, expect, it } from "vitest";

import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
} from "./helpers/plugin";

/**
 * Synthetic JSON-LD covering the schema shapes the real noracooks fixture
 * doesn't exercise: HowToSection groups, object/`@id` ingredients,
 * single-value instructions, and nested / deduped Recipe nodes.
 */
describe("fetchRecipes — JSON-LD shape normalization", () => {
  const URL = "https://example.com/recipe";

  afterEach(() => resetObsidianStub());

  async function parse(jsonLd: unknown | unknown[]) {
    respondWith(htmlWithJsonLd(jsonLd));
    const plugin = makePlugin();
    return plugin.fetchRecipes(URL);
  }

  describe("instructions", () => {
    it("keeps a HowToSection as a named group with its steps", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Layered Bake",
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Make the dough",
            itemListElement: [
              { "@type": "HowToStep", text: "Mix the flour." },
              { "@type": "HowToStep", text: "Knead well." },
            ],
          },
          { "@type": "HowToStep", text: "Bake at 200C." },
        ],
      });

      const steps = (recipe as any).recipeInstructions as any[];
      expect(steps).toHaveLength(2);
      expect(steps[0].name).toBe("Make the dough");
      expect(steps[0].itemListElement.map((s: any) => s.text)).toEqual([
        "Mix the flour.",
        "Knead well.",
      ]);
      // The trailing plain step stays a flat { text } entry.
      expect(steps[1]).toMatchObject({ text: "Bake at 200C." });
      expect(steps[1].itemListElement).toBeUndefined();
    });

    it("drops empty-text items inside a HowToSection", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Sparse Section",
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Prep",
            itemListElement: [
              { "@type": "HowToStep", text: "  " },
              { "@type": "HowToStep", text: "Chop onions." },
            ],
          },
        ],
      });

      const steps = (recipe as any).recipeInstructions as any[];
      expect(steps[0].itemListElement.map((s: any) => s.text)).toEqual([
        "Chop onions.",
      ]);
    });

    it("coerces a single string instruction into one step", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "One Liner",
        recipeInstructions: "Stir everything together and serve.",
      });

      expect((recipe as any).recipeInstructions).toEqual([
        { text: "Stir everything together and serve." },
      ]);
    });

    it("coerces a single HowToStep object into a one-element array", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Single Step",
        recipeInstructions: { "@type": "HowToStep", text: "Do the thing." },
      });

      const steps = (recipe as any).recipeInstructions as any[];
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ text: "Do the thing." });
    });

    it("falls back to a step's name when it has no text", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Name Fallback",
        recipeInstructions: [{ "@type": "HowToStep", name: "Preheat oven." }],
      });

      expect((recipe as any).recipeInstructions[0].text).toBe("Preheat oven.");
    });

    it("strips inline HTML tags from step text without joining words", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Tagged",
        recipeInstructions: [
          {
            "@type": "HowToStep",
            text: "Combine <b>flour</b> and <strong>sugar</strong> together.",
          },
        ],
      });

      // Each tag collapses to a space, so neighbouring words stay separated.
      expect((recipe as any).recipeInstructions[0].text).toBe(
        "Combine flour and sugar together.",
      );
    });
  });

  describe("ingredients", () => {
    it("flattens strings, name-objects, text-objects, and @id refs", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Recipe",
            name: "Mixed Ingredients",
            recipeIngredient: [
              "1 cup flour",
              { "@type": "HowToSupply", name: "2 eggs" },
              { text: "3 tbsp sugar" },
              { "@id": "https://example.com/#ing-salt" },
            ],
          },
          { "@id": "https://example.com/#ing-salt", name: "1 tsp salt" },
        ],
      });

      expect((recipe as any).recipeIngredient).toEqual([
        "1 cup flour",
        "2 eggs",
        "3 tbsp sugar",
        "1 tsp salt",
      ]);
    });

    it("coerces a single string ingredient into a one-element array", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "One Ingredient",
        recipeIngredient: "1 whole chicken",
      });

      expect((recipe as any).recipeIngredient).toEqual(["1 whole chicken"]);
    });

    it("strips inline HTML and drops blank ingredients", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Dirty Ingredients",
        recipeIngredient: ["<span>1 cup</span> rice", "   ", ""],
      });

      expect((recipe as any).recipeIngredient).toEqual(["1 cup rice"]);
    });
  });

  describe("author", () => {
    it("resolves an inline Person object to its name", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Authored",
        author: { "@type": "Person", name: "Jane Cook" },
      });
      expect(recipe.author).toBe("Jane Cook");
    });

    it("joins multiple authors into a comma-separated string", async () => {
      const [recipe] = await parse({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Co-authored",
        author: [{ "@type": "Person", name: "Jane Cook" }, "Bob Baker"],
      });
      expect(recipe.author).toBe("Jane Cook, Bob Baker");
    });
  });

  describe("recipe discovery", () => {
    it("finds a Recipe nested under mainEntity", async () => {
      const recipes = await parse({
        "@context": "https://schema.org",
        "@type": "WebPage",
        mainEntity: {
          "@type": "Recipe",
          name: "Nested Recipe",
          recipeIngredient: ["water"],
        },
      });

      expect(recipes).toHaveLength(1);
      expect(recipes[0].name).toBe("Nested Recipe");
    });

    it("counts a real Recipe once despite a bare @id Recipe pointer", async () => {
      const recipes = await parse({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Recipe",
            "@id": "https://example.com/#recipe",
            name: "Only Once",
            recipeIngredient: ["water"],
          },
          {
            "@type": "WebPage",
            // a content-free pointer at the recipe — must not be collected
            mainEntity: {
              "@type": "Recipe",
              "@id": "https://example.com/#recipe",
            },
          },
        ],
      });

      expect(recipes).toHaveLength(1);
      expect(recipes[0].name).toBe("Only Once");
    });

    it("collects multiple distinct recipes on one page", async () => {
      const recipes = await parse([
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "First Dish",
          recipeIngredient: ["a"],
        },
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Second Dish",
          recipeIngredient: ["b"],
        },
      ]);

      expect(recipes.map((r) => r.name)).toEqual(["First Dish", "Second Dish"]);
    });

    it("returns an empty array when the page has no Recipe schema", async () => {
      const recipes = await parse({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Just an article",
      });
      expect(recipes).toEqual([]);
    });
  });
});
