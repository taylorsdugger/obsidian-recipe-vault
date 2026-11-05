import { describe, expect, it } from "vitest";
import { applyOrder, compareRecipes, sanitizeOrder } from "../src/utils/order";

const r = (title: string, created = 0, cook_time_mins = 0, times_made = 0) => ({
  title,
  created,
  cook_time_mins,
  times_made,
});
const titles = (sections: { recipes: { title: string }[] }[]) =>
  sections.map((s) => s.recipes.map((x) => x.title));

describe("applyOrder", () => {
  const asian = [r("Bao", 300), r("Pho", 100), r("Undated"), r("Curry", 200)];

  it("orders recipes inside each section, newest first", () => {
    const out = applyOrder(
      [{ label: "Asian", recipes: asian }],
      "tag:cuisine",
      {
        field: "created",
        dir: "desc",
      },
    );
    expect(titles(out)).toEqual([["Bao", "Curry", "Pho", "Undated"]]);
  });

  it("oldest first still keeps undated recipes last", () => {
    const out = applyOrder(
      [{ label: "Asian", recipes: asian }],
      "tag:cuisine",
      {
        field: "created",
        dir: "asc",
      },
    );
    expect(titles(out)).toEqual([["Pho", "Curry", "Bao", "Undated"]]);
  });

  it("leaves sections alone for the default order", () => {
    const sections = [{ label: "x", recipes: asian }];
    expect(applyOrder(sections, "name", { field: "default", dir: "asc" })).toBe(
      sections,
    );
  });

  it("flattens the Name grouping for a non-name order", () => {
    const out = applyOrder(
      [
        { label: "A", recipes: [r("Apple", 1)] },
        { label: "Z", recipes: [r("Zucchini", 2)] },
      ],
      "name",
      { field: "created", dir: "desc" },
    );
    expect(out.map((s) => s.label)).toEqual([""]);
    expect(titles(out)).toEqual([["Zucchini", "Apple"]]);
  });

  it("flips sections when ordering against the grouping's own field", () => {
    const out = applyOrder(
      [
        { label: "November 2026", recipes: [r("New", 3)] },
        { label: "March 2025", recipes: [r("Old", 1)] },
        { label: "Unknown", recipes: [r("Undated")] },
      ],
      "created",
      { field: "created", dir: "asc" },
    );
    expect(out.map((s) => s.label)).toEqual([
      "March 2025",
      "November 2026",
      "Unknown",
    ]);
  });
});

describe("compareRecipes", () => {
  it("sorts names both ways", () => {
    const list = [r("b"), r("a"), r("c")];
    expect(
      list
        .sort((x, y) => compareRecipes(x, y, { field: "name", dir: "desc" }))
        .map((x) => x.title),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("sanitizeOrder", () => {
  it("falls back for junk and fills a missing direction", () => {
    expect(sanitizeOrder("nope")).toEqual({ field: "default", dir: "asc" });
    expect(sanitizeOrder({ field: "created" })).toEqual({
      field: "created",
      dir: "desc",
    });
  });
});
