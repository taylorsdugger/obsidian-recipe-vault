import { describe, expect, it } from "vitest";

import type { RecipeSummary } from "../src/client/api";
import {
  applyFilters,
  categoriesIn,
  NO_FILTERS,
} from "../src/client/recipe-filters";
import { searchTerms } from "../src/worker/search";

function recipe(
  title: string,
  mealType: string | null,
  cookTimeMins: number | null = null,
): RecipeSummary {
  return {
    id: title,
    title,
    photoUrl: null,
    mealType,
    cookTime: null,
    cookTimeMins,
    timesMade: 0,
    lastMade: null,
    updatedAt: "2026-10-01",
  };
}

const LIST = [
  recipe("Potato Leek Soup", "Main Course,Soup", 50),
  recipe("Lentil Soup", "soup", 30),
  recipe("Pancakes", "Breakfast", 20),
  recipe("Chana Masala", "Main Course", null),
  recipe("Toast", null, 5),
];

describe("categoriesIn", () => {
  it("folds what sites call a meal type into the fixed set, in order", () => {
    const messy = [
      recipe("A", "Main Course"),
      recipe("B", "Entrée"),
      recipe("C", "large plates"),
      recipe("D", "Soups"),
      recipe("E", "Side Dish / Appetizer"),
      recipe("F", "Vegan Cookies + Brownies"),
      recipe("G", "vegan,Gluten-Free"),
    ];
    expect(categoriesIn(messy).map((c) => c.label)).toEqual([
      "Mains",
      "Soups",
      "Sides",
      "Snacks",
      "Desserts",
    ]);
  });
});

describe("applyFilters", () => {
  it("leaves the list alone with nothing on", () => {
    expect(applyFilters(LIST, NO_FILTERS)).toHaveLength(LIST.length);
  });

  it("keeps a recipe filed under the category among others", () => {
    expect(
      applyFilters(LIST, { category: "soups", quick: false }).map(
        (r) => r.title,
      ),
    ).toEqual(["Potato Leek Soup", "Lentil Soup"]);
    expect(
      applyFilters(LIST, { category: "mains", quick: false }).map(
        (r) => r.title,
      ),
    ).toEqual(["Potato Leek Soup", "Chana Masala"]);
  });

  it("counts half an hour as quick, and an unknown time as not", () => {
    expect(
      applyFilters(LIST, { category: null, quick: true }).map((r) => r.title),
    ).toEqual(["Lentil Soup", "Pancakes", "Toast"]);
  });

  it("stacks the two", () => {
    expect(
      applyFilters(LIST, { category: "soups", quick: true }).map(
        (r) => r.title,
      ),
    ).toEqual(["Lentil Soup"]);
  });
});

describe("searchTerms", () => {
  it("splits on commas and drops the blanks", () => {
    expect(searchTerms(" chickpea, spinach ,, ")).toEqual([
      "chickpea",
      "spinach",
    ]);
  });

  it("leaves a search without a comma as one phrase", () => {
    expect(searchTerms("coconut milk")).toEqual(["coconut milk"]);
    expect(searchTerms("   ")).toEqual([]);
  });
});
