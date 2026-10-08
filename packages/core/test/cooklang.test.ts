import { describe, expect, it } from "vitest";

import {
  cooklangToJsonLd,
  noteToCooklang,
  parseCooklang,
  parseRecipesFromJsonLd,
  readRecipeVaultState,
} from "../src";

const PARSE_OPTS = {
  useBuiltInFillerWords: true,
  extraFillerWords: "",
  keptFillerWords: "",
  defaultLanguage: "en",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
};

/** Steps' text, flattened out of any sections. */
function stepTexts(recipe: Record<string, unknown>): string[] {
  return (
    (recipe.recipeInstructions as Record<string, unknown>[]) ?? []
  ).flatMap((step) =>
    step.itemListElement
      ? (step.itemListElement as { text: string }[]).map((s) => s.text)
      : [step.text as string],
  );
}

describe("cooklangToJsonLd", () => {
  it("collects ingredients from the steps and reads the markup back as text", () => {
    const recipe = cooklangToJsonLd(
      [
        "Place @bacon strips{1%kg} on a #baking sheet{} and glaze with @syrup{1/2%tbsp}.",
        "",
        "Bake for ~{25%minutes}, then add @salt and @ground black pepper{} to taste.",
      ].join("\n"),
    );

    expect(recipe.recipeIngredient).toEqual([
      "1 kg bacon strips",
      "1/2 tbsp syrup",
      "salt",
      "ground black pepper",
    ]);
    expect(stepTexts(recipe)).toEqual([
      "Place bacon strips on a baking sheet and glaze with syrup.",
      "Bake for 25 minutes, then add salt and ground black pepper to taste.",
    ]);
  });

  // Cases lifted from the spec's canonical tests (cooklang/spec tests/canonical.yaml).
  it.each([
    ["Add some @chilli, then serve", "Add some chilli, then serve", ["chilli"]],
    ["@chilli cut into pieces", "chilli cut into pieces", ["chilli"]],
    [
      "Top with @1000 island dressing{ }",
      "Top with 1000 island dressing",
      ["1000 island dressing"],
    ],
    ["@chilli{ 3 % items }", "chilli", ["3 items chilli"]],
    ["@milk{1 / 2 %cup}", "milk", ["1/2 cup milk"]],
    ["@thyme{few%sprigs}", "thyme", ["few sprigs thyme"]],
    ["Message me @ example", "Message me @ example", []],
    ["Message @ example{}", "Message @ example{}", []],
    [
      "Fry in #7-inch nonstick frying pan{ }",
      "Fry in 7-inch nonstick frying pan",
      [],
    ],
    ["Fry for ~potato{42%minutes}", "Fry for 42 minutes", []],
    ["Let it ~rest after plating", "Let it rest after plating", []],
    ["It is ~ {5}", "It is ~ {5}", []],
    [
      "Preheat the oven to 200℃/Fan 180°C.",
      "Preheat the oven to 200℃/Fan 180°C.",
      [],
    ],
  ])("reads %j", (source, step, ingredients) => {
    const recipe = cooklangToJsonLd(source);
    expect(stepTexts(recipe)).toEqual([step]);
    expect(recipe.recipeIngredient ?? []).toEqual(ingredients);
  });

  it("keeps short-hand preparations as the ingredient's prep note", () => {
    const recipe = cooklangToJsonLd(
      "Mix @onion{1}(peeled and finely chopped) and @garlic{2%cloves}(minced).",
    );
    expect(recipe.recipeIngredient).toEqual([
      "1 onion, peeled and finely chopped",
      "2 cloves garlic, minced",
    ]);
    expect(stepTexts(recipe)).toEqual(["Mix onion and garlic."]);
  });

  it("drops comments without splitting the step they sat in", () => {
    const recipe = cooklangToJsonLd(
      [
        "-- Don't burn the roux!",
        "Mash @potato{2%kg} until smooth -- or boil them first",
        "[- TODO litres -]and add @milk{4%cup}, keep mixing",
      ].join("\n"),
    );
    expect(stepTexts(recipe)).toEqual([
      "Mash potato until smooth and add milk, keep mixing",
    ]);
  });

  it("treats a paragraph as one step and a blank line as the break", () => {
    const recipe = cooklangToJsonLd(
      [
        "A step,",
        "the same step.",
        "",
        "A different step.\\",
        "Still that one.",
      ].join("\n"),
    );
    expect(stepTexts(recipe)).toEqual([
      "A step, the same step.",
      "A different step. Still that one.",
    ]);
  });

  it("turns named sections into HowToSections and > lines into notes", () => {
    const recipe = cooklangToJsonLd(
      [
        "> Better the next day.",
        "",
        "Heat the #oven{}.",
        "",
        "= Dough",
        "",
        "Mix @flour{200%g} and @water{100%ml}.",
        "",
        "== Filling ==",
        "Combine @cheese{100%g} and @spinach{50%g}.",
      ].join("\n"),
    );

    expect(recipe.recipeInstructions).toEqual([
      { "@type": "HowToStep", text: "Heat the oven." },
      {
        "@type": "HowToSection",
        name: "Dough",
        itemListElement: [
          { "@type": "HowToStep", text: "Mix flour and water." },
        ],
      },
      {
        "@type": "HowToSection",
        name: "Filling",
        itemListElement: [
          { "@type": "HowToStep", text: "Combine cheese and spinach." },
        ],
      },
    ]);
    expect(recipe.recipeNotes).toEqual(["Better the next day."]);
  });

  it("lists an ingredient once unless it's given a second amount", () => {
    const recipe = cooklangToJsonLd(
      [
        "Melt @butter{2%tbsp}.",
        "",
        "Stir in the @butter and @&butter{} again.",
        "",
        "Finish with @butter{1%tbsp}.",
      ].join("\n"),
    );
    expect(recipe.recipeIngredient).toEqual(["2 tbsp butter", "1 tbsp butter"]);
  });

  it("reads a referenced recipe by its name", () => {
    const recipe = cooklangToJsonLd("Pour over @./sauces/Hollandaise{150%g}.");
    expect(recipe.recipeIngredient).toEqual(["150 g Hollandaise"]);
    expect(stepTexts(recipe)).toEqual(["Pour over Hollandaise."]);
  });

  it("maps canonical front matter onto schema.org", () => {
    const recipe = cooklangToJsonLd(
      [
        "---",
        "title: Spaghetti Carbonara",
        "source: https://example.com/carbonara",
        "author: Marcella",
        "course: Dinner",
        "cuisine: Italian",
        "servings: 4",
        "time: 1h30m",
        "image: https://example.com/carbonara.jpg",
        "tags:",
        "  - pasta",
        "  - quick",
        "---",
        "Boil @spaghetti{400%g}.",
      ].join("\n"),
      { name: "carbonara-file" },
    );

    expect(recipe).toMatchObject({
      "@type": "Recipe",
      name: "Spaghetti Carbonara",
      url: "https://example.com/carbonara",
      author: { "@type": "Person", name: "Marcella" },
      recipeCategory: "Dinner",
      recipeCuisine: "Italian",
      recipeYield: "4",
      totalTime: "PT1H30M",
      image: "https://example.com/carbonara.jpg",
      keywords: "pasta, quick",
    });
  });

  it("falls back to the file name, nested source keys, and prep plus cook time", () => {
    const recipe = cooklangToJsonLd(
      [
        "---",
        "source:",
        "  name: Mum's notebook",
        "  url: https://example.com/soup",
        "  author: Mum",
        "Prep Time: 15 minutes",
        "Cook Time: 1 hour",
        "---",
        "Simmer @stock{1%l}.",
      ].join("\n"),
      { name: "Soup" },
    );

    expect(recipe.name).toBe("Soup");
    expect(recipe.url).toBe("https://example.com/soup");
    expect(recipe.author).toEqual({ "@type": "Person", name: "Mum" });
    expect(recipe.totalTime).toBe("PT1H15M");
  });

  it("reads the older >> metadata lines", () => {
    const recipe = cooklangToJsonLd(
      [
        ">> title: Toast",
        ">> servings: 2",
        "",
        "Toast the @bread{2%slices}.",
      ].join("\n"),
    );
    expect(recipe.name).toBe("Toast");
    expect(recipe.recipeYield).toBe("2");
    expect(stepTexts(recipe)).toEqual(["Toast the bread."]);
  });

  it("goes through the JSON-LD normalize pass like any other import", () => {
    const [recipe] = parseRecipesFromJsonLd(
      [cooklangToJsonLd("Boil @eggs{2} for ~{7%minutes}.", { name: "Eggs" })],
      PARSE_OPTS,
    );
    expect(recipe.name).toBe("Eggs");
    expect(recipe.recipeIngredient).toEqual(["2 eggs"]);
    expect(recipe.recipeInstructions).toEqual([
      { text: "Boil eggs for 7 minutes." },
    ]);
  });
});

const NOTE = [
  "---",
  "cssclasses: recipe-note",
  "tags:",
  "- recipe",
  "meal_type: Dinner",
  "author: Marcella Hazan",
  "cook_time: 1h 30m",
  "url: https://example.com/ragu",
  'photo: "[[Recipe Images/ragu.jpg]]"',
  "times_made: 4",
  "last_made: 2026-09-01",
  "---",
  "",
  "# [Ragu](https://example.com/ragu)",
  "",
  "### Ingredients",
  "",
  "- [ ] 1 yellow onion, diced",
  "- [ ] 2 tbsp butter",
  "- [ ] 1 1/2 cups whole milk",
  "- [ ] 1 bay leaf",
  "",
  "### Instructions",
  "",
  "1. Soften the onions in the butter.",
  "2. Add the whole milk and simmer for an hour.",
  "",
  "## Notes",
  "",
  "- Better the next day.",
  "",
].join("\n");

describe("parseCooklang", () => {
  it("splits a step into text and markup tokens", () => {
    const { sections } = parseCooklang(
      "Boil @water{2%l} in a #pot for ~{10%minutes}, then add @salt.",
    );

    expect(sections[0].steps[0].tokens).toEqual([
      { type: "text", value: "Boil " },
      {
        type: "ingredient",
        name: "water",
        quantity: "2",
        unit: "l",
        prep: "",
        reference: false,
      },
      { type: "text", value: " in a " },
      { type: "cookware", name: "pot", quantity: "" },
      { type: "text", value: " for " },
      { type: "timer", name: "", quantity: "10", unit: "minutes" },
      { type: "text", value: ", then add " },
      {
        type: "ingredient",
        name: "salt",
        quantity: "",
        unit: "",
        prep: "",
        reference: false,
      },
      { type: "text", value: "." },
    ]);
    expect(sections[0].steps[0].text).toBe(
      "Boil water in a pot for 10 minutes, then add salt.",
    );
  });

  it("keeps markup that isn't markup as text", () => {
    const { sections } = parseCooklang("Email me @ home # soon");
    expect(sections[0].steps[0].tokens).toEqual([
      { type: "text", value: "Email me @ home # soon" },
    ]);
  });

  it("lists cookware once each and drops empty sections", () => {
    const recipe = parseCooklang(
      [
        "Heat a #frying pan{}.",
        "",
        "= Empty =",
        "",
        "= Sauce =",
        "Whisk in the #frying pan{} with a #whisk.",
      ].join("\n"),
    );

    expect(recipe.cookware).toEqual(["frying pan", "whisk"]);
    expect(recipe.sections.map((section) => section.name)).toEqual([
      "",
      "Sauce",
    ]);
  });

  it("skips references in the ingredient list", () => {
    const { ingredients } = parseCooklang(
      "Mix @flour{200%g}. Dust with @&flour{}.",
    );
    expect(ingredients.map((i) => i.name)).toEqual(["flour"]);
  });

  it("keeps a recipe reference's path for linking", () => {
    const { sections, ingredients } = parseCooklang(
      "Top with @./Sauces/Hollandaise{150%g} and @../Basics/Stock.cook{1%l}.",
    );
    const linked = sections[0].steps[0].tokens.filter(
      (token) => token.type === "ingredient",
    );
    expect(linked).toMatchObject([
      { name: "Hollandaise", recipe: "Sauces/Hollandaise" },
      { name: "Stock", recipe: "../Basics/Stock.cook" },
    ]);
    expect(ingredients.map((i) => i.recipe)).toEqual([
      "Sauces/Hollandaise",
      "../Basics/Stock.cook",
    ]);
    expect(sections[0].steps[0].text).toBe("Top with Hollandaise and Stock.");
  });

  it("hands cooklangToJsonLd the same recipe the text would give", () => {
    const source = [
      "---",
      "title: Toast",
      "servings: 2",
      "---",
      "Toast @bread{2%slices} in a #toaster.",
    ].join("\n");
    expect(cooklangToJsonLd(parseCooklang(source))).toEqual(
      cooklangToJsonLd(source),
    );
  });
});

describe("noteToCooklang", () => {
  it("marks ingredients up where the steps mention them", () => {
    const cook = noteToCooklang(NOTE, { name: "Ragu" });

    expect(cook).toBe(
      [
        "---",
        "title: Ragu",
        "source: https://example.com/ragu",
        "author: Marcella Hazan",
        "course: Dinner",
        "time: 1h30m",
        "times made: 4",
        "last made: 2026-09-01",
        "---",
        "",
        "Gather @bay leaf{1}.",
        "",
        "Soften the @yellow onion{1}(diced) in the @butter{2%tbsp}.",
        "",
        "Add the @whole milk{1 1/2%cups} and simmer for an hour.",
        "",
        "> Better the next day.",
        "",
      ].join("\n"),
    );
  });

  it("gives every full name its match before any short name gets one", () => {
    // "large onion" shortens to "onion", which would otherwise land on the
    // "onion" inside "red onion" because that mention comes first.
    const note = [
      "### Ingredients",
      "- [ ] 1 large onion",
      "- [ ] 1 red onion",
      "### Instructions",
      "- Fry the red onion, then add the onions.",
    ].join("\n");

    expect(noteToCooklang(note, { name: "Onions" })).toContain(
      "Fry the @red onion{1}, then add the @large onion{1}.",
    );
  });

  it("keeps step text that would read as markup from turning into it", () => {
    const note = ["### Instructions", "- Use a #10 can -- or two @ most."].join(
      "\n",
    );

    expect(noteToCooklang(note, { name: "Can" })).toContain(
      "Use a # 10 can – or two @ most.",
    );
  });

  it("round-trips through cooklangToJsonLd", () => {
    const back = cooklangToJsonLd(noteToCooklang(NOTE, { name: "Ragu" }));
    const [recipe] = parseRecipesFromJsonLd([back], PARSE_OPTS);

    expect(recipe.name).toBe("Ragu");
    expect(recipe.url).toBe("https://example.com/ragu");
    expect(recipe.author).toBe("Marcella Hazan");
    expect(recipe.totalTime).toBe("PT1H30M");
    expect(recipe.recipeIngredient).toEqual([
      "1 bay leaf",
      "1 yellow onion, diced",
      "2 tbsp butter",
      "1 1/2 cups whole milk",
    ]);
    expect(recipe.recipeInstructions).toEqual([
      { text: "Gather bay leaf." },
      { text: "Soften the yellow onion in the butter." },
      { text: "Add the whole milk and simmer for an hour." },
    ]);
    expect(recipe.recipeNotes).toEqual(["Better the next day."]);
    expect(readRecipeVaultState(recipe)).toEqual({
      timesMade: 4,
      lastMade: "2026-09-01",
    });
  });
});
