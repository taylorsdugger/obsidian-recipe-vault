import { describe, expect, it } from "vitest";

import {
  createRecipeRenderer,
  DEFAULT_TEMPLATE,
  readRecipeFile,
  recipeFormatOf,
  recipeToCooklang,
  setRecipeHistory,
} from "../src";

const COOK = [
  "---",
  "title: Easy Pancakes",
  "source: https://example.com/pancakes",
  "author: Taylor",
  "course: breakfast",
  "time: 1h 5m",
  "times made: 3",
  "last made: 2026-09-01",
  "---",
  "> Rest the batter.",
  "",
  "Whisk @eggs{2} and @milk{250%ml} in a #bowl.",
  "",
  "== Cook ==",
  "Fry in @butter{1%tbsp}(melted).",
].join("\n");

describe("recipeFormatOf", () => {
  it("knows notes and Cooklang files by extension", () => {
    expect(recipeFormatOf("Recipes/Pie.md")).toBe("markdown");
    expect(recipeFormatOf("Recipes/Pie.COOK")).toBe("cooklang");
    expect(recipeFormatOf("Recipes/pie.json")).toBeNull();
  });
});

describe("readRecipeFile", () => {
  it("reads a .cook file into the same summary a note gets", () => {
    expect(readRecipeFile("Recipes/Pancakes.cook", COOK)).toEqual({
      format: "cooklang",
      isRecipe: true,
      title: "Easy Pancakes",
      author: "Taylor",
      sourceUrl: "https://example.com/pancakes",
      photo: "",
      mealType: "breakfast",
      cookTime: "1h 5m",
      cookTimeMins: 65,
      timesMade: 3,
      lastMade: "2026-09-01",
      dateAdded: "",
      sourceFile: "",
      ingredients: ["2 eggs", "250 ml milk", "1 tbsp butter, melted"],
      instructions: ["Whisk eggs and milk in a bowl.", "Fry in butter."],
      notes: ["Rest the batter."],
    });
  });

  it("keeps a vault path for the photo, not only a url", () => {
    const summary = readRecipeFile(
      "Recipes/Soup.cook",
      "---\nimage: assets/Leek-Soup.jpg\n---\n\nSimmer @leeks{2}.",
    );
    expect(summary?.photo).toBe("assets/Leek-Soup.jpg");
  });

  it("reads a note's photo from the configured property, then photo", () => {
    const custom = '---\nimage_url: "https://x.test/a.jpg"\n---\n# Soup\n';
    expect(
      readRecipeFile("Recipes/Soup.md", custom, { photoProperty: "image_url" })
        ?.photo,
    ).toBe("https://x.test/a.jpg");
    expect(readRecipeFile("Recipes/Soup.md", custom)?.photo).toBe("");

    // A note made before the property changed still has its photo.
    const old = '---\nphoto: "[[Recipe Images/soup.jpg]]"\n---\n# Soup\n';
    expect(
      readRecipeFile("Recipes/Soup.md", old, { photoProperty: "image_url" })
        ?.photo,
    ).toBe("Recipe Images/soup.jpg");
  });

  it("falls back to the file name and says when there's no recipe", () => {
    const summary = readRecipeFile("Recipes/Empty One.cook", "");
    expect(summary?.title).toBe("Empty One");
    expect(summary?.isRecipe).toBe(false);
  });

  it("reads a note made from the default template", () => {
    const md = createRecipeRenderer(DEFAULT_TEMPLATE)({
      name: "Toast",
      url: "https://example.com/toast",
      author: "Taylor",
      recipeCategory: "breakfast",
      totalTime: "PT10M",
      recipeIngredient: ["2 slices bread"],
      recipeInstructions: [{ text: "Toast the bread." }],
    });
    const summary = readRecipeFile("Recipes/Toast.md", md);
    expect(summary).toMatchObject({
      format: "markdown",
      isRecipe: true,
      title: "Toast",
      sourceUrl: "https://example.com/toast",
      mealType: "breakfast",
      cookTimeMins: 10,
      timesMade: 0,
      ingredients: ["2 slices bread"],
      instructions: ["Toast the bread."],
    });
  });
});

describe("setRecipeHistory", () => {
  it("uses the Cooklang key names in a .cook file", () => {
    const out = setRecipeHistory("Pancakes.cook", COOK, {
      timesMade: 4,
      lastMade: "2026-10-01",
    });
    const summary = readRecipeFile("Pancakes.cook", out);
    expect(summary?.timesMade).toBe(4);
    expect(summary?.lastMade).toBe("2026-10-01");
    expect(out).not.toContain("times made: 3");
  });

  it("adds front matter to a .cook file that has none", () => {
    const out = setRecipeHistory("Toast.cook", "Toast @bread{2%slices}.", {
      timesMade: 1,
      lastMade: "2026-10-01",
    });
    expect(out).toBe(
      "---\ntimes made: 1\nlast made: 2026-10-01\n---\n\nToast @bread{2%slices}.",
    );
    expect(readRecipeFile("Toast.cook", out)?.ingredients).toEqual([
      "2 slices bread",
    ]);
  });

  it("uses the note's key names in a .md file", () => {
    const out = setRecipeHistory("Toast.md", "---\ntimes_made: 0\n---\n", {
      timesMade: 1,
      lastMade: "2026-10-01",
    });
    expect(out).toBe("---\ntimes_made: 1\nlast_made: 2026-10-01\n---\n");
  });
});

describe("recipeToCooklang", () => {
  it("writes an imported recipe with its metadata and sections", () => {
    const cook = recipeToCooklang({
      name: "Pancakes",
      url: "https://example.com/pancakes",
      description: "Thin and lacy.",
      recipeYield: ["4", "4 servings"],
      recipeCuisine: "French",
      totalTime: "PT25M",
      image: "https://example.com/pancakes.jpg",
      recipeIngredient: ["2 eggs", "250 ml milk", "1 pinch salt"],
      recipeInstructions: [
        { text: "Whisk the eggs and milk." },
        {
          "@type": "HowToSection",
          name: "Cook",
          itemListElement: [{ text: "Fry until golden." }],
        },
      ],
      recipeNotes: ["Rest the batter."],
    });

    expect(cook).toBe(
      [
        "---",
        "title: Pancakes",
        "description: Thin and lacy.",
        "source: https://example.com/pancakes",
        "cuisine: French",
        "servings: 4",
        "time: 25m",
        "image: https://example.com/pancakes.jpg",
        "---",
        "",
        "Gather @salt{1%pinch}.",
        "",
        "Whisk the @eggs{2} and @milk{250%ml}.",
        "",
        "== Cook ==",
        "",
        "Fry until golden.",
        "",
        "> Rest the batter.",
        "",
      ].join("\n"),
    );

    const back = readRecipeFile("Pancakes.cook", cook);
    expect(back?.ingredients).toEqual(["1 pinch salt", "2 eggs", "250 ml milk"]);
    expect(back?.instructions).toEqual([
      "Gather salt.",
      "Whisk the eggs and milk.",
      "Fry until golden.",
    ]);
  });

  it("leaves a vault-local photo out of the file", () => {
    const cook = recipeToCooklang({
      name: "Toast",
      image: "Recipe Images/Toast.jpg",
      recipeInstructions: [{ text: "Toast it." }],
    });
    expect(cook).not.toContain("image:");
  });
});
