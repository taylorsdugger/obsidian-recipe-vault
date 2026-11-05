import { describe, expect, it } from "vitest";
import {
  buildTagGroups,
  filterByTags,
  groupByNamespace,
  parseTags,
  sortableNamespaces,
} from "../src/utils/tagFilter";

const r = (title: string, tags: string[]) => ({ title, tags });
const recipes = [
  r("Pad Thai", ["recipe", "cuisine/thai", "dish/noodles", "diet/dairy-free"]),
  r("Lasagna", ["recipe", "cuisine/italian", "dish/casserole"]),
  r("Pho", ["recipe", "cuisine/vietnamese", "dish/noodles", "diet/dairy-free"]),
  r("Fusion", ["recipe", "cuisine/thai", "cuisine/italian", "vegetarian"]),
];

describe("parseTags", () => {
  it("reads lists and strings, normalizing # and case", () => {
    expect(parseTags(["Recipe", "#Cuisine/Thai", "recipe"])).toEqual([
      "recipe",
      "cuisine/thai",
    ]);
    expect(parseTags("a, #b c")).toEqual(["a", "b", "c"]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags([null, 2024])).toEqual(["2024"]);
  });
});

describe("filterByTags", () => {
  it("matches all / any, and parents match nested tags", () => {
    const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
    expect(
      titles(filterByTags(recipes, ["cuisine/thai", "dish/noodles"], "all")),
    ).toEqual(["Pad Thai"]);
    expect(
      titles(filterByTags(recipes, ["cuisine/thai", "dish/noodles"], "any")),
    ).toEqual(["Pad Thai", "Pho", "Fusion"]);
    expect(titles(filterByTags(recipes, ["dish"], "all"))).toEqual([
      "Pad Thai",
      "Lasagna",
      "Pho",
    ]);
    expect(filterByTags(recipes, [], "all")).toHaveLength(4);
  });
});

describe("buildTagGroups", () => {
  it("groups by namespace, hides universal tags, plain tags last", () => {
    const groups = buildTagGroups(recipes, recipes, [], "all");
    expect(groups.map((g) => g.namespace)).toEqual([
      "cuisine",
      "diet",
      "dish",
      "",
    ]);
    expect(groups.at(-1)!.tags.map((t) => t.tag)).toEqual(["vegetarian"]);
    const cuisine = groups[0].tags;
    expect(cuisine.map((t) => [t.label, t.count])).toEqual([
      ["italian", 2],
      ["thai", 2],
      ["vietnamese", 1],
    ]);
  });

  it("counts within the current selection in all mode", () => {
    const groups = buildTagGroups(recipes, recipes, ["dish/noodles"], "all");
    const cuisine = groups.find((g) => g.namespace === "cuisine")!.tags;
    expect(Object.fromEntries(cuisine.map((t) => [t.label, t.count]))).toEqual({
      italian: 0,
      thai: 1,
      vietnamese: 1,
    });
    const any = buildTagGroups(recipes, recipes, ["dish/noodles"], "any");
    expect(
      any.find((g) => g.namespace === "cuisine")!.tags.map((t) => t.count),
    ).toEqual([2, 2, 1]);
  });
});

describe("tag sorting", () => {
  it("lists namespaces with 2+ tags and groups by them", () => {
    expect(sortableNamespaces(recipes)).toEqual(["cuisine", "dish"]);
    const sections = groupByNamespace(recipes, "cuisine");
    expect(
      sections.map((s) => [s.label, s.recipes.map((x) => x.title)]),
    ).toEqual([
      ["italian", ["Fusion", "Lasagna"]],
      ["thai", ["Fusion", "Pad Thai"]],
      ["vietnamese", ["Pho"]],
    ]);
    expect(groupByNamespace(recipes, "dish").at(-1)!.label).toBe("No dish");
  });
});

describe("groupByNamespace with selected tags", () => {
  it("keeps only the picked sections and drops the catch-all", () => {
    const sections = groupByNamespace(recipes, "cuisine", [
      "cuisine/thai",
      "dish/noodles",
    ]);
    expect(sections.map((s) => s.label)).toEqual(["thai"]);
    expect(
      groupByNamespace(recipes, "cuisine", ["dish/noodles"]).at(-1)!.label,
    ).toBe("vietnamese");
  });
});

describe("buildTagGroups review cases", () => {
  const chip = (groups: ReturnType<typeof buildTagGroups>, tag: string) =>
    groups.flatMap((g) => g.tags).find((t) => t.tag === tag);

  it("counts a parent tag with its nested tags, before and after picking it", () => {
    const list = [
      r("a", ["dish"]),
      r("b", ["dish/soup"]),
      r("c", ["dish/soup"]),
      r("d", ["cuisine/thai"]),
    ];
    const before = chip(buildTagGroups(list, list, [], "all"), "dish");
    const after = chip(buildTagGroups(list, list, ["dish"], "all"), "dish");
    expect(before?.count).toBe(3);
    expect(after?.count).toBe(3);
  });

  it("still hides a blanket tag when .cook recipes (no tags) are present", () => {
    const list = [
      { title: "a", path: "a.md", tags: ["recipe", "dish/soup"] },
      { title: "b", path: "b.md", tags: ["recipe"] },
      { title: "c", path: "c.cook", tags: [] },
    ];
    const groups = buildTagGroups(list, list, [], "all");
    expect(chip(groups, "recipe")).toBeUndefined();
    expect(chip(groups, "dish/soup")?.count).toBe(1);
  });
});
