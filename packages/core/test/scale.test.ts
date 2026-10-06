import { describe, expect, it } from "vitest";

import {
  formatQuantity,
  itemsFromIngredientLine,
  parseCooklang,
  parseQuantity,
  scaleCooklang,
  scaleIngredientLine,
  scaleLabel,
  scaleQuantity,
  scaleYield,
  servingsOf,
  stepScale,
  yieldLabel,
} from "../src";

describe("parseQuantity", () => {
  it("reads the shapes recipes write amounts in", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("1/2")).toBe(0.5);
    expect(parseQuantity("1 1/2")).toBe(1.5);
    expect(parseQuantity("½")).toBe(0.5);
    expect(parseQuantity("1½")).toBe(1.5);
    expect(parseQuantity("1⁄4")).toBe(0.25);
  });

  it("is null for words", () => {
    expect(parseQuantity("some")).toBeNull();
    expect(parseQuantity("1/0")).toBeNull();
  });
});

describe("formatQuantity", () => {
  it("writes kitchen fractions", () => {
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(1 / 3)).toBe("⅓");
    expect(formatQuantity(0.75)).toBe("¾");
    expect(formatQuantity(4)).toBe("4");
    expect(formatQuantity(2.98)).toBe("3");
  });

  it("falls back to a decimal below an eighth", () => {
    expect(formatQuantity(1 / 32)).toBe("0.03");
  });

  it("writes decimals when asked", () => {
    expect(formatQuantity(1.5, true)).toBe("1.5");
    expect(formatQuantity(112.5, true)).toBe("113");
    expect(formatQuantity(12.25, true)).toBe("12.3");
  });
});

describe("scaleQuantity", () => {
  it("scales a plain amount and both ends of a range", () => {
    expect(scaleQuantity("1/2", 2)).toBe("1");
    expect(scaleQuantity("2-3", 2)).toBe("4-6");
    expect(scaleQuantity("250", 1.5, "ml")).toBe("375");
    expect(scaleQuantity("1", 1.5, "kg")).toBe("1.5");
  });

  it("leaves words and 1x alone", () => {
    expect(scaleQuantity("a pinch", 2)).toBe("a pinch");
    expect(scaleQuantity("1 1/2", 1)).toBe("1 1/2");
  });
});

describe("scaleIngredientLine", () => {
  it("doubles the amount in front and spells the unit to match", () => {
    expect(scaleIngredientLine("1 cup flour", 2)).toBe("2 cups flour");
    expect(scaleIngredientLine("2 cloves garlic, minced", 0.5)).toBe(
      "1 clove garlic, minced",
    );
    expect(scaleIngredientLine("1 1/2 tsp salt", 2)).toBe("3 tsp salt");
    expect(scaleIngredientLine("½ Cup sugar", 3)).toBe("1½ Cups sugar");
  });

  it("spells a counted noun to match", () => {
    expect(scaleIngredientLine("1 onion, diced", 2)).toBe("2 onions, diced");
    expect(scaleIngredientLine("3 large eggs", 1 / 3)).toBe("1 large egg");
    expect(scaleIngredientLine("1 tomato", 2)).toBe("2 tomatoes");
  });

  it("scales only the count, not a package size", () => {
    expect(scaleIngredientLine("1 (14 oz) can tomatoes", 2)).toBe(
      "2 (14 oz) cans tomatoes",
    );
    expect(scaleIngredientLine("1 (14 oz) tomatoes", 2)).toBe(
      "2 (14 oz) tomatoes",
    );
    expect(scaleIngredientLine("2 20-ounce cans jackfruit", 0.5)).toBe(
      "1 20-ounce can jackfruit",
    );
  });

  it("writes metric amounts as decimals, stuck to the unit or not", () => {
    expect(scaleIngredientLine("200g butter", 1.5)).toBe("300g butter");
    expect(scaleIngredientLine("1 kg potatoes", 1.5)).toBe("1.5 kg potatoes");
    expect(scaleIngredientLine("1.5 cups stock", 2)).toBe("3 cups stock");
  });

  it("scales ranges", () => {
    expect(scaleIngredientLine("2-3 tbsp oil", 2)).toBe("4-6 tbsp oil");
    expect(scaleIngredientLine("1 to 2 cups water", 2)).toBe(
      "2 to 4 cups water",
    );
  });

  it("leaves a line with no amount in front", () => {
    expect(scaleIngredientLine("salt to taste", 2)).toBe("salt to taste");
    expect(scaleIngredientLine("Juice of 1 lemon", 2)).toBe("Juice of 1 lemon");
  });

  it("changes nothing at 1x", () => {
    expect(scaleIngredientLine("1 1/2 cup flour", 1)).toBe("1 1/2 cup flour");
  });

  it("writes lines the shopping list can still add up", () => {
    const [item] = itemsFromIngredientLine(
      scaleIngredientLine("1 kg flour", 1.5),
      "Bread",
    );
    expect(item.amount).toBe(1.5);
    expect(item.unit).toBe("kg");
    const [cups] = itemsFromIngredientLine(
      scaleIngredientLine("1 cup milk", 1.5),
      "Bread",
    );
    expect(cups.amount).toBe(1.5);
    expect(cups.unit).toBe("cup");
  });
});

describe("servings", () => {
  it("reads the number out of a yield", () => {
    expect(servingsOf("4")).toBe(4);
    expect(servingsOf("4 servings")).toBe(4);
    expect(servingsOf("Serves 4-6")).toBe(4);
    expect(servingsOf("")).toBeNull();
    expect(servingsOf("a crowd")).toBeNull();
  });

  it("labels what a scaled recipe makes", () => {
    expect(yieldLabel("4", 1.5)).toBe("Serves 6");
    expect(yieldLabel("4-6", 2)).toBe("Serves 8-12");
    expect(yieldLabel("12 cookies", 2)).toBe("24 cookies");
    expect(yieldLabel("", 2)).toBe("");
  });

  it("scales the number in a yield", () => {
    expect(scaleYield("Serves 4", 2)).toBe("Serves 8");
    expect(scaleYield("4-6 servings", 0.5)).toBe("2-3 servings");
    expect(scaleYield("12 cookies", 1.5)).toBe("18 cookies");
  });
});

describe("stepScale", () => {
  it("moves a serving at a time when it knows the servings", () => {
    expect(stepScale(1, 1, 4)).toBe(1.25);
    expect(stepScale(1, -1, 4)).toBe(0.75);
    expect(stepScale(0.25, -1, 4)).toBe(0.25);
  });

  it("walks the fixed steps otherwise", () => {
    expect(stepScale(1, 1)).toBe(1.5);
    expect(stepScale(1, -1)).toBe(0.5);
    expect(stepScale(0.5, -1)).toBe(0.5);
    expect(stepScale(4, 1)).toBe(4);
  });

  it("labels a factor", () => {
    expect(scaleLabel(0.5)).toBe("½×");
    expect(scaleLabel(2)).toBe("2×");
  });
});

describe("scaleCooklang", () => {
  const recipe = parseCooklang(
    [
      "---",
      "servings: 2",
      "---",
      "Whisk @eggs{2} with @milk{250%ml} and @salt{=1%pinch}.",
      "",
      "Melt @butter{1%cup} in a #pan{} for ~{5%minutes}.",
    ].join("\n"),
  );

  it("scales the list and the steps, and leaves fixed amounts", () => {
    const doubled = scaleCooklang(recipe, 2);
    expect(doubled.metadata.servings).toBe("4");
    expect(
      doubled.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    ).toEqual([
      ["4", "", "eggs"],
      ["500", "ml", "milk"],
      ["1", "pinch", "salt"],
      ["2", "cups", "butter"],
    ]);
    const tokens = doubled.sections[0].steps[1].tokens;
    expect(tokens.find((t) => t.type === "ingredient")).toMatchObject({
      quantity: "2",
      unit: "cups",
    });
    expect(tokens.find((t) => t.type === "timer")).toMatchObject({
      quantity: "5",
    });
  });

  it("hands back the same recipe at 1x", () => {
    expect(scaleCooklang(recipe, 1)).toBe(recipe);
  });

  it("marks a fixed amount", () => {
    expect(recipe.ingredients[2].fixed).toBe(true);
    expect(recipe.ingredients[0].fixed).toBeUndefined();
  });
});
