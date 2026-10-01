import { describe, expect, it } from "vitest";

import { deriveRecipeFields } from "../src/worker/db/recipe-row";

describe("deriveRecipeFields", () => {
  it("reads a .cook file by its key", () => {
    const cook = [
      "---",
      "title: Leek Soup",
      "source: https://example.com/soup",
      "course: dinner",
      "time: 45 minutes",
      "image: https://example.com/soup.jpg",
      "---",
      "",
      "Simmer @stock{1%l} with @leeks{2} for ~{40%minutes}.",
    ].join("\n");

    expect(deriveRecipeFields(cook, "Recipes/All recipes/Leek Soup.cook")).toEqual({
      title: "Leek Soup",
      author: null,
      sourceUrl: "https://example.com/soup",
      photoUrl: "https://example.com/soup.jpg",
      mealType: "dinner",
      cookTime: "45 minutes",
      cookTimeMins: 45,
      ingredients: JSON.stringify(["1 l stock", "2 leeks"]),
    });
  });

  it("keeps reading a note the way it did", () => {
    const md = [
      "---",
      "url: https://example.com/toast",
      "cook_time: 10m",
      "photo: Recipe Images/toast.jpg",
      "---",
      "# [Toast](https://example.com/toast)",
      "",
      "### Ingredients",
      "- [ ] 2 slices bread",
      "",
      "### Instructions",
      "- Toast it.",
    ].join("\n");

    expect(deriveRecipeFields(md)).toMatchObject({
      title: "Toast",
      sourceUrl: "https://example.com/toast",
      photoUrl: null,
      cookTimeMins: 10,
      ingredients: JSON.stringify(["2 slices bread"]),
    });
    expect(deriveRecipeFields("no heading here").title).toBe("Untitled recipe");
  });
});
