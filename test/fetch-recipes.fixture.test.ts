import { afterEach, describe, expect, it } from "vitest";

import {
  loadFixture,
  makePlugin,
  resetObsidianStub,
  respondWith,
} from "./helpers/plugin";

/**
 * Regression tests against a real captured page: noracooks.com's vegan chicken
 * noodle soup. It exercises the shapes the recent import fixes targeted —
 * a Yoast `@graph` whose author is an `{ "@id": … }` reference to a separate
 * Person node, 13 plain-string ingredients, and 5 `HowToStep` instructions.
 */
describe("fetchRecipes — noracooks real fixture", () => {
  const FIXTURE = "noracooks-vegan-chicken-noodle-soup.html";
  const URL =
    "https://www.noracooks.com/vegan-chicken-noodle-soup/#wprm-recipe-container-8103";

  afterEach(() => resetObsidianStub());

  async function parseFixture() {
    respondWith(loadFixture(FIXTURE));
    const plugin = makePlugin();
    return plugin.fetchRecipes(URL);
  }

  it("extracts exactly one recipe with its cleaned name", async () => {
    const recipes = await parseFixture();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe("Vegan Chicken Noodle Soup");
  });

  it("resolves the author @id reference to the Person node's name", async () => {
    const [recipe] = await parseFixture();
    // author in the graph is `{ "@id": ".../person/750d…" }`; the Person node
    // it points at has name "Nora".
    expect(recipe.author).toBe("Nora");
  });

  it("flattens the 13 string ingredients verbatim", async () => {
    const [recipe] = await parseFixture();
    const ingredients = (recipe as any).recipeIngredient as string[];
    expect(ingredients).toHaveLength(13);
    expect(ingredients.every((i) => typeof i === "string")).toBe(true);
    expect(ingredients[0]).toBe("2 tablespoons olive oil");
    expect(ingredients[ingredients.length - 1]).toBe(
      "crackers or french bread, for serving",
    );
  });

  it("normalizes the 5 HowToStep instructions to plain { text } steps", async () => {
    const [recipe] = await parseFixture();
    const steps = (recipe as any).recipeInstructions as any[];
    expect(steps).toHaveLength(5);
    // All are flat steps — none should be promoted to a HowToSection group.
    expect(steps.every((s) => typeof s.text === "string" && s.text)).toBe(true);
    expect(steps.every((s) => s.itemListElement === undefined)).toBe(true);
    expect(steps[0].text).toMatch(/^Add the olive oil to a large pot/);
  });

  it("leaves HTML entities in step text for the later gated decode pass", async () => {
    const [recipe] = await parseFixture();
    const steps = (recipe as any).recipeInstructions as any[];
    // stripHtml removes tags + collapses whitespace but intentionally does NOT
    // decode entities, so `don&#x27;t` survives into the normalized step.
    expect(steps[4].text).toContain("Serve the soup in bowls");
    expect(steps[4].text).toContain("&#x27;");
  });

  it("reduces the image array to a single URL string", async () => {
    const [recipe] = await parseFixture();
    expect(recipe.image).toBe(
      "https://www.noracooks.com/wp-content/uploads/2019/12/IMG_9605.jpg",
    );
  });
});
