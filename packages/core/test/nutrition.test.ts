import { describe, expect, it } from "vitest";

import {
  addRecipeNutrition,
  cooklangToJsonLd,
  createRecipeRenderer,
  DEFAULT_TEMPLATE,
  ensureNutritionFrontmatter,
  ensureRequiredRecipeFrontmatter,
  formatNutrient,
  macroSplit,
  noteToCooklang,
  noteToJsonLd,
  nutritionFromFields,
  nutritionFromJsonLd,
  nutritionView,
  pageNutrition,
  parseNutrientAmount,
  readFrontmatter,
  readRecipeFile,
  recipeToCooklang,
} from "../src";

/** What WP Recipe Maker and most food blogs put in their JSON-LD. */
const PAGE_NUTRITION = {
  "@type": "NutritionInformation",
  calories: "530 kcal",
  proteinContent: "17 g",
  carbohydrateContent: "58 g",
  fatContent: "26 g",
  fiberContent: "14 g",
  sugarContent: "10 g",
  sodiumContent: "690 mg",
  servingSize: "1 serving",
};

describe("parseNutrientAmount", () => {
  it("reads the ways pages write an amount", () => {
    expect(parseNutrientAmount("530 calories", "")).toBe(530);
    expect(parseNutrientAmount("1,200 kcal", "")).toBe(1200);
    expect(parseNutrientAmount("17g", "g")).toBe(17);
    expect(parseNutrientAmount("<1 g", "g")).toBe(1);
    expect(parseNutrientAmount("2,5 g", "g")).toBe(2.5);
    expect(parseNutrientAmount(42, "g")).toBe(42);
  });

  it("converts units to the nutrient's own", () => {
    expect(parseNutrientAmount("0.69 g", "mg")).toBeCloseTo(690);
    expect(parseNutrientAmount("1500 mg", "g")).toBeCloseTo(1.5);
    expect(parseNutrientAmount("2218 kJ", "")).toBeCloseTo(530, 0);
  });

  it("skips anything without a usable number", () => {
    expect(parseNutrientAmount("", "g")).toBeUndefined();
    expect(parseNutrientAmount("n/a", "g")).toBeUndefined();
    expect(parseNutrientAmount(-3, "g")).toBeUndefined();
    expect(parseNutrientAmount(null, "g")).toBeUndefined();
  });
});

describe("nutritionFromJsonLd", () => {
  it("maps schema.org NutritionInformation", () => {
    expect(nutritionFromJsonLd(PAGE_NUTRITION)).toEqual({
      calories: 530,
      protein: 17,
      carbs: 58,
      fat: 26,
      fiber: 14,
      sugar: 10,
      sodium: 690,
    });
  });

  it("is null for a page with none", () => {
    expect(nutritionFromJsonLd(undefined)).toBeNull();
    expect(nutritionFromJsonLd({ "@type": "NutritionInformation" })).toBeNull();
  });

  it("takes the first of a list", () => {
    expect(
      nutritionFromJsonLd([{ calories: "100" }, { calories: "200" }]),
    ).toEqual({ calories: 100 });
  });
});

describe("nutritionFromFields", () => {
  it("reads Obsidian's typed frontmatter and hand-written strings", () => {
    expect(
      nutritionFromFields({ calories: 530, protein: "17 g", Carbs: "58" }),
    ).toEqual({ calories: 530, protein: 17, carbs: 58 });
  });

  it("takes the aliases a hand-written note might use", () => {
    expect(
      nutritionFromFields({ kcal: "400", carbohydrates: 30, fibre: 4 }),
    ).toEqual({ calories: 400, carbs: 30, fiber: 4 });
  });

  it("is null when the note has none", () => {
    expect(nutritionFromFields({ servings: "4", author: "Maya" })).toBeNull();
    expect(nutritionFromFields(null)).toBeNull();
  });
});

describe("macroSplit", () => {
  it("splits calories 4/4/9 and adds up to 100", () => {
    const split = macroSplit({ protein: 17, carbs: 58, fat: 26 })!;
    expect(split.map((m) => [m.key, m.percent])).toEqual([
      ["protein", 13],
      ["carbs", 43],
      ["fat", 44],
    ]);
    expect(split.reduce((a, m) => a + m.percent, 0)).toBe(100);
  });

  it("rounds an even split to exactly 100", () => {
    const split = macroSplit({ protein: 9, carbs: 9, fat: 4 })!;
    expect(split.reduce((a, m) => a + m.percent, 0)).toBe(100);
  });

  it("needs all three", () => {
    expect(macroSplit({ protein: 17, carbs: 58 })).toBeNull();
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });
});

describe("formatNutrient", () => {
  it("keeps one place below 10 and none above", () => {
    expect(formatNutrient(17.4, "g")).toBe("17 g");
    expect(formatNutrient(0.5, "g")).toBe("0.5 g");
    expect(formatNutrient(3, "g")).toBe("3 g");
    expect(formatNutrient(690, "mg")).toBe("690 mg");
    expect(formatNutrient(2120, "")).toBe("2,120");
  });
});

describe("nutritionView", () => {
  const per = nutritionFromJsonLd(PAGE_NUTRITION)!;

  it("says what a serving is", () => {
    const view = nutritionView(per, "4", 1, false);
    expect(view.calories).toBe("530");
    expect(view.caption).toBe("per serving");
    expect(view.yields).toBe("serves 4");
    expect(view.servingNote).toBe(
      "This recipe serves 4, so a serving is a quarter of it.",
    );
    expect(view.canShowWhole).toBe(true);
    expect(view.rows.map((r) => [r.label, r.amount, r.percent])).toEqual([
      ["Protein", "17 g", 13],
      ["Carbs", "58 g", 43],
      ["Fat", "26 g", 44],
      ["Fiber", "14 g", null],
      ["Sugar", "10 g", null],
      ["Sodium", "690 mg", null],
    ]);
    expect(view.splitLabel).toBe(
      "Calories from protein 13%, carbs 43%, fat 44%",
    );
  });

  it("multiplies out the whole recipe at the current scale", () => {
    const view = nutritionView(per, "4 servings", 2, true);
    expect(view.calories).toBe("4,240");
    expect(view.caption).toBe("for the whole recipe");
    expect(view.yields).toBe("serves 8");
    expect(view.servingNote).toBe(
      "All 8 servings together, at the scale you're making it.",
    );
    expect(view.rows[0].amount).toBe("136 g");
    // The split doesn't change with the amount.
    expect(view.rows[0].percent).toBe(13);
  });

  it("can't show the whole recipe without servings", () => {
    const view = nutritionView(per, "", 1, true);
    expect(view.canShowWhole).toBe(false);
    expect(view.caption).toBe("per serving");
    expect(view.yields).toBe("");
    expect(view.servingNote).toBe(
      "The recipe doesn't say how many it serves, so there's no telling how big a serving is.",
    );
    expect(view.calories).toBe("530");
  });
});

describe("nutrition in notes and .cook files", () => {
  const render = createRecipeRenderer(DEFAULT_TEMPLATE);
  const recipe = {
    name: "Chickpea Curry",
    recipeYield: "4",
    recipeIngredient: ["1 can chickpeas"],
    recipeInstructions: [{ text: "Cook it." }],
    nutrition: PAGE_NUTRITION,
  };

  it("lands in a new note's frontmatter as plain numbers", () => {
    const md = ensureNutritionFrontmatter(
      ensureRequiredRecipeFrontmatter(render(recipe), {}),
      nutritionFromJsonLd(recipe.nutrition),
    );
    expect(md).toContain("\ncalories: 530\nprotein: 17\ncarbs: 58\nfat: 26\n");
    expect(md).toContain("\nsodium: 690\n");
    expect(readRecipeFile("Curry.md", md)?.nutrition).toEqual(
      nutritionFromJsonLd(PAGE_NUTRITION),
    );
  });

  it("leaves a key the template already wrote", () => {
    const md = "---\ncalories: 999\n---\n\n# Pie\n";
    const out = ensureNutritionFrontmatter(md, { calories: 530, fat: 26 });
    expect(readFrontmatter(out)).toEqual({ calories: "999", fat: "26" });
  });

  it("doesn't touch a note when there's nothing to add", () => {
    const md = "---\nservings: 4\n---\n";
    expect(ensureNutritionFrontmatter(md, null)).toBe(md);
  });

  it("is null in a note without any", () => {
    const md = ensureRequiredRecipeFrontmatter(
      render({ ...recipe, nutrition: undefined }),
      {},
    );
    expect(readRecipeFile("Curry.md", md)?.nutrition).toBeNull();
  });

  it("goes note → JSON-LD → .cook → summary without losing anything", () => {
    const note = ensureNutritionFrontmatter(
      ensureRequiredRecipeFrontmatter(render(recipe), {}),
      nutritionFromJsonLd(recipe.nutrition),
    );
    expect(nutritionFromJsonLd(noteToJsonLd(note).nutrition)).toEqual(
      nutritionFromJsonLd(PAGE_NUTRITION),
    );
    const cook = noteToCooklang(note);
    expect(cook).toContain("\ncalories: 530\n");
    expect(cook).toContain("\nsodium: 690\n");
    expect(readRecipeFile("Curry.cook", cook)?.nutrition).toEqual(
      nutritionFromJsonLd(PAGE_NUTRITION),
    );
  });

  it("reads a hand-written .cook file's metadata", () => {
    const cook =
      "---\ncalories: 410\nprotein: 22 g\n---\n\nBoil @pasta{200%g}.\n";
    expect(nutritionFromJsonLd(cooklangToJsonLd(cook).nutrition)).toEqual({
      calories: 410,
      protein: 22,
    });
    expect(recipeToCooklang(cooklangToJsonLd(cook))).toContain(
      "calories: 410\nprotein: 22\n",
    );
  });
});

describe("pageNutrition", () => {
  const curry = { name: "Chickpea Curry", nutrition: { calories: "530" } };
  const raita = { name: "Cucumber Raita", nutrition: { calories: "80" } };

  it("takes the recipe with the note's title", () => {
    expect(pageNutrition([raita, curry], "Chickpea curry")?.nutrition).toEqual({
      calories: 530,
    });
  });

  it("falls back to the first recipe that has any", () => {
    expect(
      pageNutrition([{ name: "Rice" }, raita], "Something else")?.nutrition,
    ).toEqual({ calories: 80 });
  });

  it("keeps the named recipe's servings even when it has no nutrition", () => {
    expect(
      pageNutrition([{ name: "Rice", recipeYield: "4" }, raita], "Rice"),
    ).toEqual({ nutrition: null, servingSize: "", servings: "4" });
    expect(pageNutrition([], "Rice")).toBeNull();
  });

  it("reads Nora Cooks' apple fritters the way the page gives them", () => {
    // Straight from the page's JSON-LD.
    const fritters = {
      name: "Apple Fritters",
      recipeYield: ["12", "12 fritters"],
      nutrition: {
        "@type": "NutritionInformation",
        servingSize: "1 of 12 fritters",
        calories: "262 kcal",
        carbohydrateContent: "43 g",
        proteinContent: "2 g",
        fatContent: "10 g",
        sodiumContent: "107 mg",
      },
    };
    expect(pageNutrition([fritters], "Apple Fritters")).toEqual({
      nutrition: { calories: 262, protein: 2, carbs: 43, fat: 10, sodium: 107 },
      servingSize: "1 of 12 fritters",
      servings: "12",
    });
  });
});

describe("addRecipeNutrition", () => {
  const found = {
    nutrition: { calories: 530, protein: 17, fat: 26 },
    servingSize: "",
    servings: "",
  };

  it("fills an empty line the template left and keeps hand-typed values", () => {
    const md =
      "---\nservings: 4\ncalories:\nkcal: 600\nprotein: 20\n---\n# Curry\n";
    const out = addRecipeNutrition("Curry.md", md, {
      ...found,
      nutrition: { ...found.nutrition, carbs: 58 },
    });
    // `kcal` already says calories, so the empty `calories:` stays empty.
    expect(readFrontmatter(out)).toEqual({
      servings: "4",
      calories: "",
      kcal: "600",
      protein: "20",
      fat: "26",
      carbs: "58",
    });
  });

  it("writes a .cook file's front matter, adding one if it has none", () => {
    expect(
      addRecipeNutrition("Curry.cook", "Boil @rice{1%cup}.\n", found),
    ).toBe(
      "---\ncalories: 530\nprotein: 17\nfat: 26\n---\n\nBoil @rice{1%cup}.\n",
    );
    const cook = "---\ntitle: Curry\nprotein: 22\n---\n\nBoil @rice{1%cup}.\n";
    expect(addRecipeNutrition("Curry.cook", cook, found)).toBe(
      "---\ntitle: Curry\nprotein: 22\ncalories: 530\nfat: 26\n---\n\nBoil @rice{1%cup}.\n",
    );
  });

  it("leaves a file alone when it already has everything", () => {
    const md = "---\ncalories: 1\nprotein: 1\nfat: 1\n---\n";
    expect(addRecipeNutrition("Curry.md", md, found)).toBe(md);
  });

  it("adds the servings and serving size an older note is missing", () => {
    // The apple fritters note: nutrition from an earlier backfill, but
    // imported before the template wrote `servings`.
    const md =
      "---\nurl: https://www.noracooks.com/apple-fritters/\ncalories: 262\n---\n";
    const out = addRecipeNutrition("Apple Fritters.md", md, {
      nutrition: { calories: 999 },
      servingSize: "1 of 12 fritters",
      servings: "12",
    });
    expect(readFrontmatter(out)).toEqual({
      url: "https://www.noracooks.com/apple-fritters/",
      calories: "262",
      serving_size: "1 of 12 fritters",
      servings: "12",
    });
  });

  it("leaves servings alone when the note says it another way", () => {
    const md = "---\nyield: 2 loaves\n---\n";
    const out = addRecipeNutrition("Bread.md", md, {
      nutrition: null,
      servingSize: "",
      servings: "16",
    });
    expect(out).toBe(md);
  });

  it("uses the .cook names for serving size", () => {
    const out = addRecipeNutrition("Fritters.cook", "Fry @apples{2}.\n", {
      nutrition: null,
      servingSize: "1 of 12 fritters",
      servings: "12",
    });
    expect(out).toContain("serving size: 1 of 12 fritters\nservings: 12\n");
    expect(readRecipeFile("Fritters.cook", out)?.servingSize).toBe(
      "1 of 12 fritters",
    );
  });
});

describe("serving size", () => {
  const per = { calories: 262 };

  it("says what a serving is when the page does", () => {
    const view = nutritionView(per, "12", 1, false, "1 of 12 fritters");
    expect(view.servingNote).toBe("A serving is 1 of 12 fritters.");
    expect(view.perLabel).toBe("per serving · 1 of 12 fritters");
  });

  it("ignores the '1 serving' most blogs put there", () => {
    const view = nutritionView(per, "4", 1, false, "1 serving");
    expect(view.perLabel).toBe("per serving · serves 4");
    expect(view.servingNote).toBe(
      "This recipe serves 4, so a serving is a quarter of it.",
    );
  });

  it("goes back to the yield for the whole recipe", () => {
    const view = nutritionView(per, "12", 1, true, "1 of 12 fritters");
    expect(view.servingNote).toBe(
      "All 12 servings together, at the scale you're making it.",
    );
  });

  it("survives note → JSON-LD → .cook → summary", () => {
    const md =
      "---\ncssclasses: recipe-note\ncalories: 262\nserving_size: 1 of 12 fritters\n---\n\n# Apple Fritters\n\n### Ingredients\n\n- [ ] 2 apples\n\n### Instructions\n\n- Fry the apples.\n";
    expect(readRecipeFile("Fritters.md", md)?.servingSize).toBe(
      "1 of 12 fritters",
    );
    const cook = noteToCooklang(md);
    expect(cook).toContain("serving size: 1 of 12 fritters");
    expect(readRecipeFile("Fritters.cook", cook)?.servingSize).toBe(
      "1 of 12 fritters",
    );
  });
});

describe("what a serving is", () => {
  const per = { calories: 300 };
  const note = (servings: string, factor = 1) =>
    nutritionView(per, servings, factor, false).servingNote;

  it("words the share for small counts and writes a fraction past that", () => {
    expect(note("2")).toBe("This recipe serves 2, so a serving is half of it.");
    expect(note("3")).toBe(
      "This recipe serves 3, so a serving is a third of it.",
    );
    expect(note("6")).toBe("This recipe serves 6, so a serving is 1/6 of it.");
    expect(note("1")).toBe("This recipe serves 1, so a serving is all of it.");
  });

  it("follows the scale: a double batch serves twice as many", () => {
    expect(note("4", 2)).toBe(
      "This recipe serves 8, so a serving is 1/8 of it.",
    );
  });

  it("reads '4 servings' as a number of servings", () => {
    expect(note("4 servings")).toBe(
      "This recipe serves 4, so a serving is a quarter of it.",
    );
  });

  it("uses the yield as written when it isn't a bare number", () => {
    expect(note("12 cookies")).toBe(
      "This recipe makes 12 cookies, so a serving is 1/12 of it.",
    );
    expect(nutritionView(per, "12 cookies", 1, false).yields).toBe(
      "makes 12 cookies",
    );
  });

  it("leaves the share out when it isn't a whole number of servings", () => {
    expect(note("3", 0.5)).toBe("This recipe serves 1½.");
  });
});
