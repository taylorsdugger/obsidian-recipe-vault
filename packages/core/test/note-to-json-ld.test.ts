import { describe, expect, it } from "vitest";

import {
  createRecipeRenderer,
  DEFAULT_TEMPLATE,
  ensureRequiredRecipeFrontmatter,
  noteToJsonLd,
  parseRecipesFromJsonLd,
  readRecipeVaultState,
  type JsonRecord,
} from "../src";

const PARSE_OPTS = {
  fillerWordsMode: "auto" as const,
  customFillerWords: "",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
};

const NOTE = [
  "---",
  "cssclasses: recipe-note",
  "tags:",
  "- recipe",
  "date_added: 2026-09-08",
  "created: 2024-01-02",
  "meal_type: Dinner, Comfort food",
  "author: Marcella Hazan",
  "cook_time: 1h 30m",
  "url: https://example.com/ragu",
  'photo: "https://example.com/ragu.jpg"',
  "times_made: 4",
  "last_made: 2026-09-01",
  "---",
  "",
  "# [Ragu](https://example.com/ragu)",
  "",
  "### Ingredients",
  "",
  "- [ ] 1 onion, diced",
  "- [x] 2 tbsp butter",
  "",
  "### Instructions",
  "",
  "1. Soften the onion.",
  "2. Simmer for an hour.",
  "",
  "## Notes",
  "",
  "- Better the next day.",
  "",
].join("\n");

describe("noteToJsonLd", () => {
  it("builds a schema.org Recipe from a note", () => {
    const recipe = noteToJsonLd(NOTE, { name: "Ragu" });

    expect(recipe["@context"]).toBe("https://schema.org");
    expect(recipe["@type"]).toBe("Recipe");
    expect(recipe.name).toBe("Ragu");
    expect(recipe.author).toEqual({
      "@type": "Person",
      name: "Marcella Hazan",
    });
    expect(recipe.url).toBe("https://example.com/ragu");
    expect(recipe.datePublished).toBe("2024-01-02");
    expect(recipe.recipeCategory).toEqual(["Dinner", "Comfort food"]);
    expect(recipe.recipeIngredient).toEqual([
      "1 onion, diced",
      "2 tbsp butter",
    ]);
    expect(recipe.recipeInstructions).toEqual([
      { "@type": "HowToStep", text: "Soften the onion." },
      { "@type": "HowToStep", text: "Simmer for an hour." },
    ]);
    expect(recipe.recipeNotes).toEqual(["Better the next day."]);
  });

  it("writes cook time back as an ISO duration", () => {
    expect(noteToJsonLd(NOTE).totalTime).toBe("PT1H30M");
    expect(noteToJsonLd(NOTE.replace("1h 30m", "45m")).totalTime).toBe("PT45M");
    expect(noteToJsonLd(NOTE.replace("1h 30m", "2h")).totalTime).toBe("PT2H");
  });

  it("keeps a remote photo and drops a vault-local one", () => {
    expect(noteToJsonLd(NOTE).image).toBe("https://example.com/ragu.jpg");

    const local = NOTE.replace(
      'photo: "https://example.com/ragu.jpg"',
      'photo: "[[Recipe Images/ragu.jpg]]"',
    );
    expect(noteToJsonLd(local).image).toBeUndefined();
  });

  it("carries cooking history under its own key, not as schema.org fields", () => {
    const recipe = noteToJsonLd(NOTE);
    expect(recipe.times_made).toBeUndefined();
    expect(recipe.last_made).toBeUndefined();
    expect(recipe.recipeVault).toEqual({
      timesMade: 4,
      lastMade: "2026-09-01",
    });
  });

  it("omits the vault block for a recipe that has never been made", () => {
    const fresh = NOTE.replace("times_made: 4", "times_made: 0").replace(
      "last_made: 2026-09-01",
      "last_made:",
    );
    expect(noteToJsonLd(fresh).recipeVault).toBeUndefined();
  });

  it("falls back to the note's heading for the name", () => {
    expect(noteToJsonLd(NOTE).name).toBe("Ragu");
    expect(noteToJsonLd("# Plain Heading\n").name).toBe("Plain Heading");
  });

  it("omits empty fields rather than writing blanks", () => {
    const recipe = noteToJsonLd("# Bare\n");
    expect(Object.keys(recipe)).toEqual(["@context", "@type", "name"]);
  });

  it("uses a single string for one category and a list for several", () => {
    const one = NOTE.replace(
      "meal_type: Dinner, Comfort food",
      "meal_type: Dinner",
    );
    expect(noteToJsonLd(one).recipeCategory).toBe("Dinner");
  });
});

describe("parseRecipesFromJsonLd", () => {
  it("parses a standalone file with no source url", () => {
    const [recipe] = parseRecipesFromJsonLd(
      [
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Soup",
          recipeIngredient: ["2 cups stock"],
          recipeInstructions: "Simmer.",
        },
      ],
      PARSE_OPTS,
    );

    expect(recipe.name).toBe("Soup");
    expect(recipe.url).toBeUndefined();
    expect(recipe.recipeInstructions).toEqual([{ text: "Simmer." }]);
  });

  it("keeps the recipe's own url when no source url is given", () => {
    const [recipe] = parseRecipesFromJsonLd(
      [{ "@type": "Recipe", name: "Soup", url: "https://example.com/soup" }],
      PARSE_OPTS,
    );
    expect(recipe.url).toBe("https://example.com/soup");
  });

  it("stamps the source url over the recipe's own when given one", () => {
    const [recipe] = parseRecipesFromJsonLd(
      [{ "@type": "Recipe", name: "Soup", url: "https://example.com/soup" }],
      { ...PARSE_OPTS, sourceUrl: "https://example.com/page" },
    );
    expect(recipe.url).toBe("https://example.com/page");
  });

  it("finds a recipe nested in an @graph", () => {
    const recipes = parseRecipesFromJsonLd(
      [
        {
          "@graph": [
            { "@type": "Person", "@id": "#chef", name: "Marcella" },
            {
              "@type": "Recipe",
              name: "Ragu",
              author: { "@id": "#chef" },
              recipeIngredient: ["1 onion"],
            },
          ],
        },
      ],
      PARSE_OPTS,
    );

    expect(recipes).toHaveLength(1);
    expect(recipes[0].author).toBe("Marcella");
  });
});

describe("note to JSON-LD and back", () => {
  it("round-trips a recipe through export and import", () => {
    const exported = noteToJsonLd(NOTE, { name: "Ragu" });
    const [reimported] = parseRecipesFromJsonLd([exported], PARSE_OPTS);

    expect(reimported.name).toBe("Ragu");
    expect(reimported.url).toBe("https://example.com/ragu");
    expect(reimported.author).toBe("Marcella Hazan");
    expect(reimported.recipeIngredient).toEqual([
      "1 onion, diced",
      "2 tbsp butter",
    ]);
    expect(reimported.recipeInstructions).toEqual([
      { text: "Soften the onion.", image: undefined },
      { text: "Simmer for an hour.", image: undefined },
    ]);
    expect(reimported.recipeNotes).toEqual(["Better the next day."]);
    expect(readRecipeVaultState(reimported as JsonRecord)).toEqual({
      timesMade: 4,
      lastMade: "2026-09-01",
    });
  });

  it("survives a render back into a note", () => {
    const exported = noteToJsonLd(NOTE, { name: "Ragu" });
    const [reimported] = parseRecipesFromJsonLd([exported], PARSE_OPTS);

    const render = createRecipeRenderer(DEFAULT_TEMPLATE);
    const note = ensureRequiredRecipeFrontmatter(
      render(reimported as JsonRecord),
      {},
    );

    const again = noteToJsonLd(note, { name: "Ragu" });
    expect(again.recipeIngredient).toEqual(exported.recipeIngredient);
    expect(again.recipeInstructions).toEqual(exported.recipeInstructions);
    expect(again.totalTime).toBe(exported.totalTime);
  });
});

describe("readRecipeVaultState", () => {
  it("reads what noteToJsonLd wrote", () => {
    expect(readRecipeVaultState(noteToJsonLd(NOTE))).toEqual({
      timesMade: 4,
      lastMade: "2026-09-01",
    });
  });

  it("returns nothing for a recipe without the key", () => {
    expect(readRecipeVaultState({ "@type": "Recipe" })).toEqual({});
  });

  it("ignores a malformed block rather than trusting it", () => {
    expect(readRecipeVaultState({ recipeVault: "4" })).toEqual({});
    expect(readRecipeVaultState({ recipeVault: [1, 2] })).toEqual({});
    expect(
      readRecipeVaultState({ recipeVault: { timesMade: "many", lastMade: 7 } }),
    ).toEqual({});
    expect(
      readRecipeVaultState({ recipeVault: { timesMade: -3, lastMade: "  " } }),
    ).toEqual({ timesMade: 0 });
  });
});
