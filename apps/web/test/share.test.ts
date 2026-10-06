import { describe, expect, it } from "vitest";

import { publicRecipe } from "../src/worker/routes/share";

const base = {
  title: "Chickpea Curry",
  vaultKey: "Recipes/Chickpea Curry.md",
  mealType: "dinner",
  cookTime: "40 min",
  author: "Maya Tran",
  sourceUrl: "https://example.com/curry",
  photoUrl: null,
};

describe("publicRecipe", () => {
  it("reads the sections out of a note and leaves the history behind", () => {
    const markdown = [
      "---",
      "times_made: 6",
      "last_made: 2026-09-30",
      "---",
      "# Chickpea Curry",
      "",
      "### Ingredients",
      "- 2 cans chickpeas",
      "- 1 onion",
      "",
      "### Instructions",
      "1. Fry the chickpeas.",
      "2. Add the onion.",
      "",
      "## Notes",
      "- Doubles well.",
    ].join("\n");

    const view = publicRecipe({ ...base, markdown });

    expect(view.ingredients).toEqual(["2 cans chickpeas", "1 onion"]);
    expect(view.steps).toEqual(["Fry the chickpeas.", "Add the onion."]);
    expect(view.notes).toEqual(["Doubles well."]);
    expect(JSON.stringify(view)).not.toMatch(/times|last_made|2026-09-30/);
  });

  it("carries the macros, and what a serving is", () => {
    const markdown = [
      "---",
      "servings: 4",
      "calories: 420",
      "protein: 18",
      "carbs: 52",
      "fat: 14",
      "---",
      "### Ingredients",
      "- 2 cans chickpeas",
      "",
      "### Instructions",
      "1. Fry the chickpeas.",
    ].join("\n");

    const view = publicRecipe({ ...base, markdown });

    expect(view.nutrition).toMatchObject({
      calories: 420,
      protein: 18,
      carbs: 52,
      fat: 14,
    });
    expect(view.servings).toBe("4");
  });

  it("has no nutrition when the note doesn't", () => {
    const view = publicRecipe({
      ...base,
      markdown: "### Ingredients\n- 1 onion\n\n### Instructions\n1. Fry it.",
    });
    expect(view.nutrition).toBeNull();
  });

  it("reads a .cook file by its key", () => {
    const view = publicRecipe({
      ...base,
      vaultKey: "Recipes/Leek Soup.cook",
      markdown: "Simmer @stock{1%l} with @leeks{2} for ~{40%minutes}.",
    });

    expect(view.ingredients).toEqual(["1 l stock", "2 leeks"]);
    expect(view.steps).toHaveLength(1);
  });
});
