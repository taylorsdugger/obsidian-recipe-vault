import { describe, expect, it } from "vitest";
import {
  cookSteps,
  countChecked,
  holdsActions,
  ingredientLines,
  ingredientsForStep,
  recipeOutline,
  sectionRole,
  setTaskLine,
  sliceBody,
  takeCheckedIngredients,
  taskLines,
} from "../src/recipe-structure";

// What the default template writes, give or take the recipe.
const NOTE = `---
cssclasses: recipe-note
tags:
- recipe
---

# [Crispy Chickpea Curry](https://example.com/curry)

![Crispy Chickpea Curry](images/curry.jpg)

A weeknight curry.

> [!recipe-meta] At a Glance
> **Meal type**: Dinner
> **Cook time**: 40 min

### Ingredients

- [x] 2 cans (15 oz) chickpeas, drained
- [ ] 1 large yellow onion, diced
- [ ] 4 cloves garlic, minced
- [x] 1 green chili, slit
- [ ] 3 tbsp neutral oil

### Instructions

#### Crisp the chickpeas
- Pat the chickpeas dry and fry them in 2 tbsp oil.

#### Build the sauce
- Cook the onion until golden.
- Stir in the garlic and chili, then bring to a boil.

-----

## Notes
- Doubles well.
`;

const lineOf = (text: string) => NOTE.split("\n").findIndex((l) => l.includes(text));

describe("recipeOutline", () => {
  const outline = recipeOutline(NOTE);

  it("finds each part of the note by line", () => {
    expect(outline.hero?.start).toBe(lineOf("![Crispy"));
    expect(outline.meta?.start).toBe(lineOf("[!recipe-meta]"));
    expect(outline.ingredients?.start).toBe(lineOf("### Ingredients"));
    expect(outline.ingredients?.end).toBe(lineOf("### Instructions"));
    // The #### groups stay inside the instructions.
    expect(outline.instructions?.end).toBe(lineOf("## Notes"));
    expect(outline.notes?.end).toBe(NOTE.split("\n").length);
  });

  it("anchors the actions to the last line of the callout", () => {
    expect(outline.actionsAnchor).toBe(lineOf("**Cook time**"));
  });

  it("anchors the actions above the ingredients when there's no callout", () => {
    const plain = "# Soup\n\n![soup](soup.jpg)\n\nGood soup.\n\n## Ingredients\n- [ ] water\n";
    expect(recipeOutline(plain).actionsAnchor).toBe(4);
  });

  it("ignores headings inside front matter and code fences", () => {
    const tricky = "---\ntitle: x\n---\n```\n# Ingredients\n```\n## Ingredients\n- [ ] salt\n";
    expect(recipeOutline(tricky).ingredients?.start).toBe(6);
  });
});

describe("sectionRole", () => {
  const outline = recipeOutline(NOTE);
  const role = (line: number) => sectionRole(outline, line, line);

  it("tags each rendered section", () => {
    expect(role(lineOf("# [Crispy"))).toBeNull();
    expect(role(lineOf("![Crispy"))).toBe("hero");
    expect(role(lineOf("A weeknight"))).toBeNull();
    expect(sectionRole(outline, lineOf("[!recipe-meta]"), lineOf("**Cook time**"))).toBe("meta");
    expect(role(lineOf("### Ingredients"))).toBe("ingredients");
    expect(role(lineOf("chickpeas, drained"))).toBe("ingredients");
    expect(role(lineOf("#### Build"))).toBe("instructions");
    expect(role(lineOf("-----"))).toBe("instructions");
    expect(role(lineOf("Doubles well"))).toBe("notes");
  });

  it("knows which section holds the actions", () => {
    expect(holdsActions(outline, lineOf("[!recipe-meta]"), lineOf("**Cook time**"))).toBe(true);
    expect(holdsActions(outline, lineOf("### Ingredients"), lineOf("### Ingredients"))).toBe(false);
  });
});

describe("ingredient tasks", () => {
  const range = recipeOutline(NOTE).ingredients!;

  it("slices the body without the heading", () => {
    const { text, firstLine } = sliceBody(NOTE, range);
    expect(firstLine).toBe(lineOf("### Ingredients") + 1);
    expect(text.trim().split("\n")).toHaveLength(5);
  });

  it("counts and lists the ticked lines", () => {
    expect(taskLines(NOTE, range)).toHaveLength(5);
    expect(countChecked(NOTE, range)).toBe(2);
  });

  it("sets a task to a state rather than flipping it", () => {
    const line = lineOf("yellow onion");
    const ticked = setTaskLine(NOTE, line, true);
    expect(ticked.split("\n")[line]).toBe("- [x] 1 large yellow onion, diced");
    // Setting it again is a no-op, so a second toggle can't undo the first.
    expect(setTaskLine(ticked, line, true)).toBe(ticked);
    expect(setTaskLine(ticked, line, false)).toBe(NOTE);
  });

  it("lists ingredient lines without markers", () => {
    expect(ingredientLines(NOTE, range)[0]).toBe("2 cans (15 oz) chickpeas, drained");
  });
});

describe("cookSteps", () => {
  const outline = recipeOutline(NOTE);

  it("flattens the steps and keeps their group", () => {
    const steps = cookSteps(NOTE, outline.instructions!);
    expect(steps.map((s) => s.group)).toEqual([
      "Crisp the chickpeas",
      "Build the sauce",
      "Build the sauce",
    ]);
    expect(steps[1].text).toBe("Cook the onion until golden.");
  });

  it("folds indented lines into the step above", () => {
    const md = "## Steps\n1. Boil water.\n   - salt it well\n2. Add pasta.\n";
    const steps = cookSteps(md, recipeOutline(md).instructions!);
    expect(steps.map((s) => s.text)).toEqual([
      "Boil water. salt it well",
      "Add pasta.",
    ]);
  });

  it("treats paragraphs as steps when there's no list", () => {
    const md = "## Method\nMix it.\n\nBake it.\n";
    expect(cookSteps(md, recipeOutline(md).instructions!).map((s) => s.text)).toEqual([
      "Mix it.",
      "Bake it.",
    ]);
  });
});

describe("ingredientsForStep", () => {
  const lines = [
    "4 cloves garlic, minced",
    "1 tbsp fresh ginger, grated",
    "1 green chili, slit",
    "1 tsp ground cumin",
    "3 tbsp neutral oil",
    "Salt and pepper",
    "2 cans (15 oz) chickpeas, drained",
  ];

  it("matches names with amounts, units and prep stripped", () => {
    expect(
      ingredientsForStep("Stir in the garlic, ginger and chili, then the cumin.", lines),
    ).toEqual(["4 cloves garlic", "1 tbsp fresh ginger", "1 green chili", "1 tsp ground cumin"]);
  });

  it("matches whole words only", () => {
    expect(ingredientsForStep("Bring to a boil.", lines)).toEqual([]);
  });

  it("matches plurals and each half of a pair", () => {
    expect(ingredientsForStep("Season with pepper.", lines)).toEqual(["Salt and pepper"]);
    expect(ingredientsForStep("Fry the chickpea in oil.", lines)).toEqual([
      "3 tbsp neutral oil",
      "2 cans (15 oz) chickpeas",
    ]);
  });
});

describe("takeCheckedIngredients", () => {
  it("returns the ticked lines and unticks them", () => {
    const { text, checked } = takeCheckedIngredients(NOTE);
    expect(checked).toEqual(["2 cans (15 oz) chickpeas, drained", "1 green chili, slit"]);
    expect(countChecked(text, recipeOutline(text).ingredients!)).toBe(0);
  });

  it("leaves ticks outside the ingredients alone", () => {
    const md = "## Ingredients\n- [x] salt\n#### For the sauce\n- [x] cream\n## Notes\n- [x] made it\n";
    const { text, checked } = takeCheckedIngredients(md);
    // A sub-heading inside the ingredients doesn't end them.
    expect(checked).toEqual(["salt", "cream"]);
    expect(text).toContain("- [x] made it");
  });
});
