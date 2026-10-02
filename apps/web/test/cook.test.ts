import { describe, expect, it } from "vitest";

import {
  chipText,
  ingredientName,
  ingredientsForStep,
} from "../src/client/cook";

const CURRY = [
  "2 cans (15 oz) chickpeas, drained",
  "1 large yellow onion, diced",
  "4 cloves garlic, minced",
  "1 tbsp fresh ginger, grated",
  "1 green chili, slit",
  "2 tsp garam masala",
  "1 tsp ground cumin",
  "1 can (14 oz) crushed tomatoes",
  "3/4 cup coconut milk",
  "5 oz baby spinach",
  "2 tbsp olive oil",
];

describe("chipText", () => {
  it("keeps the quantity and drops the prep and the parenthetical", () => {
    expect(chipText("2 cans (15 oz) chickpeas, drained")).toBe(
      "2 cans chickpeas",
    );
    expect(chipText("Salt")).toBe("Salt");
  });
});

describe("ingredientName", () => {
  it("strips numbers, units and size words", () => {
    expect(ingredientName("1 large yellow onion, diced")).toBe("yellow onion");
    expect(ingredientName("4 cloves garlic, minced")).toBe("garlic");
    expect(ingredientName("3/4 cup coconut milk")).toBe("coconut milk");
    expect(ingredientName("1 1/2 tsp ground cumin")).toBe("cumin");
    expect(ingredientName("½ lemon")).toBe("lemon");
    expect(ingredientName("2-3 tbsp. olive oil")).toBe("olive oil");
  });

  it("doesn't mistake a word for a one-letter unit", () => {
    expect(ingredientName("2 carrots")).toBe("carrots");
    expect(ingredientName("1 lime")).toBe("lime");
  });
});

describe("ingredientsForStep", () => {
  it("finds the whole name or its last word", () => {
    expect(
      ingredientsForStep(
        "Stir in the garlic, ginger and chili for 1 minute, then the garam masala and cumin for 30 seconds.",
        CURRY,
      ),
    ).toEqual([
      "4 cloves garlic",
      "1 tbsp fresh ginger",
      "1 green chili",
      "2 tsp garam masala",
      "1 tsp ground cumin",
    ]);
  });

  it("matches singular against plural", () => {
    expect(
      ingredientsForStep("Pat the chickpeas dry. Add the tomato.", CURRY),
    ).toEqual(["2 cans chickpeas", "1 can crushed tomatoes"]);
  });

  it("matches whole words only", () => {
    expect(ingredientsForStep("Bring a pot of water to a boil.", CURRY)).toEqual(
      [],
    );
  });

  it("is empty when nothing is mentioned", () => {
    expect(ingredientsForStep("Serve over rice.", CURRY)).toEqual([]);
  });
});
