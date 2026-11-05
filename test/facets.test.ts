import { describe, expect, it } from "vitest";
import {
  facetChips,
  filterByFacets,
  sanitizeFacetSelections,
} from "../src/utils/facets";
import { parseCreated } from "../src/utils/recipeLoader";

const r = (
  title: string,
  meal_type: string[],
  cook_time_mins: number,
  times_made: number,
) => ({ title, meal_type, cook_time_mins, times_made });

const recipes = [
  r("Eggs", ["Breakfast"], 10, 5),
  r("Stew", ["Dinner"], 180, 0),
  r("Wrap", ["Lunch", "Dinner"], 20, 2),
  r("Mystery", [], 0, 0),
];
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe("filterByFacets", () => {
  it("ORs within a facet and ANDs across facets", () => {
    expect(
      titles(filterByFacets(recipes, { meal_type: ["Breakfast", "Dinner"] })),
    ).toEqual(["Eggs", "Stew", "Wrap"]);
    expect(
      titles(
        filterByFacets(recipes, {
          meal_type: ["Dinner"],
          times_made: ["Never made"],
        }),
      ),
    ).toEqual(["Stew"]);
    expect(
      titles(filterByFacets(recipes, { meal_type: ["Uncategorized"] })),
    ).toEqual(["Mystery"]);
  });

  it("can ignore one facet (for that facet's own chip counts)", () => {
    expect(
      filterByFacets(recipes, { meal_type: ["Breakfast"] }, "meal_type"),
    ).toHaveLength(4);
  });
});

describe("facetChips", () => {
  it("orders values and counts from the pool", () => {
    const pool = filterByFacets(recipes, { times_made: ["Never made"] });
    expect(facetChips(recipes, pool, "meal_type")).toEqual([
      { value: "Breakfast", count: 0 },
      { value: "Dinner", count: 1 },
      { value: "Lunch", count: 0 },
      { value: "Uncategorized", count: 1 },
    ]);
    expect(
      facetChips(recipes, recipes, "cook_time").map((c) => c.value),
    ).toEqual(["Under 15 min", "15–30 min", "2+ hr", "Unknown"]);
    expect(
      facetChips(recipes, recipes, "times_made").map((c) => c.value),
    ).toEqual(["4–10 times", "1–3 times", "Never made"]);
  });
});

describe("sanitizeFacetSelections", () => {
  it("keeps only known keys and string values", () => {
    expect(
      sanitizeFacetSelections({
        meal_type: ["Dinner", 3, "Dinner"],
        bogus: ["x"],
        cook_time: [],
      }),
    ).toEqual({ meal_type: ["Dinner"] });
    expect(sanitizeFacetSelections(null)).toEqual({});
  });
});

describe("name facet", () => {
  it("groups by first letter with # last", () => {
    const list = [...recipes, r("10-minute soup", [], 10, 0)];
    expect(facetChips(list, list, "name").map((c) => c.value)).toEqual([
      "E",
      "M",
      "S",
      "W",
      "#",
    ]);
    expect(titles(filterByFacets(list, { name: ["#", "S"] }))).toEqual([
      "Stew",
      "10-minute soup",
    ]);
  });
});

describe("created facet", () => {
  const at = (iso: string) => Date.parse(iso);
  const r = (title: string, created?: number) => ({
    title,
    meal_type: [],
    cook_time_mins: 0,
    times_made: 0,
    created,
  });

  it("groups by month and orders chips newest first, Unknown last", () => {
    const recipes = [
      r("Old", at("2025-03-10T12:00:00")),
      r("Undated"),
      r("New", at("2026-11-02T12:00:00")),
      r("Newer", at("2026-11-04T12:00:00")),
    ];
    expect(facetChips(recipes, recipes, "created")).toEqual([
      { value: "November 2026", count: 2 },
      { value: "March 2025", count: 1 },
      { value: "Unknown", count: 1 },
    ]);
  });

  it("filters by picked months", () => {
    const recipes = [
      r("Old", at("2025-03-10T12:00:00")),
      r("New", at("2026-11-02T12:00:00")),
    ];
    expect(
      filterByFacets(recipes, { created: ["March 2025"] }).map((x) => x.title),
    ).toEqual(["Old"]);
  });
});

describe("parseCreated", () => {
  it("reads dates and rejects junk", () => {
    expect(parseCreated("2026-11-05")).toBe(Date.parse("2026-11-05"));
    expect(parseCreated("2017-12-30 16:22")).toBe(
      new Date(2017, 11, 30, 16, 22).getTime(),
    );
    expect(parseCreated(new Date(5))).toBe(5);
    expect(parseCreated("not a date")).toBe(0);
    expect(parseCreated(undefined)).toBe(0);
  });
});
