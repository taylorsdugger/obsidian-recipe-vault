import { describe, expect, it } from "vitest";

import {
  itemFromLine,
  mergeShoppingItems,
  parseShoppingListMarkdown,
  removeCheckedItems,
  renderShoppingListMarkdown,
  type ShoppingItem,
} from "../src";

/**
 * The merge and note round-trip that used to live inline in the plugin's
 * "add checked ingredients" command. These pin the behaviour the plugin had
 * before the code moved, so the plugin's list files keep reading the same.
 */

describe("itemFromLine", () => {
  it("parses a line and tags it with the source recipe", () => {
    expect(itemFromLine("2 cups flour", "Bread")).toEqual({
      checked: false,
      amount: 2,
      unit: "cup",
      name: "flour",
      sources: ["Bread"],
      original: "2 cups flour",
    });
  });

  it("replaces an existing source annotation with the given source", () => {
    expect(itemFromLine("1 tsp salt *(Soup)*", "Stew").sources).toEqual([
      "Stew",
    ]);
  });

  it("keeps an unparseable line as a raw item", () => {
    expect(itemFromLine("", "Bread")).toEqual({
      checked: false,
      amount: 0,
      unit: "",
      name: "",
      sources: ["Bread"],
      original: "",
    });
  });
});

describe("mergeShoppingItems", () => {
  it("appends items with no name match", () => {
    const existing: ShoppingItem[] = [];
    const { items, mergedCount } = mergeShoppingItems(existing, [
      itemFromLine("2 cups flour", "Bread"),
    ]);
    expect(items).toBe(existing);
    expect(mergedCount).toBe(0);
    expect(items).toHaveLength(1);
  });

  it("adds amounts when the unit matches", () => {
    const { items, mergedCount } = mergeShoppingItems(
      [itemFromLine("2 cups flour", "Bread")],
      [itemFromLine("1 cup flour", "Cake")],
    );
    expect(mergedCount).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      amount: 3,
      unit: "cup",
      sources: ["Bread", "Cake"],
    });
  });

  it("converts compatible units through the base unit", () => {
    const { items } = mergeShoppingItems(
      [itemFromLine("1 cup milk", "Pancakes")],
      [itemFromLine("2 tbsp milk", "Sauce")],
    );
    expect(items).toHaveLength(1);
    expect(items[0].unit).toBe("cup");
    expect(items[0].amount).toBeCloseTo(54 / 48);
  });

  it("keeps incompatible units as a second row but still unions sources", () => {
    const { items, mergedCount } = mergeShoppingItems(
      [itemFromLine("1 cup butter", "Cake")],
      [itemFromLine("4 oz butter", "Sauce")],
    );
    expect(mergedCount).toBe(1);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      amount: 1,
      unit: "cup",
      sources: ["Cake", "Sauce"],
    });
    expect(items[1]).toMatchObject({
      amount: 4,
      unit: "oz",
      sources: ["Sauce"],
    });
  });

  it("adds unitless counts", () => {
    const { items } = mergeShoppingItems(
      [itemFromLine("3 eggs", "Cake")],
      [itemFromLine("2 eggs", "Omelette")],
    );
    expect(items[0]).toMatchObject({ amount: 5, unit: "" });
  });

  it("does not duplicate a source already on the row", () => {
    const { items } = mergeShoppingItems(
      [itemFromLine("1 onion", "Soup")],
      [itemFromLine("1 onion", "Soup")],
    );
    expect(items[0].sources).toEqual(["Soup"]);
  });
});

describe("parseShoppingListMarkdown / renderShoppingListMarkdown", () => {
  const note = [
    "# Shopping List",
    "",
    "Some notes.",
    "",
    "",
    "- [ ] 2 cups flour *(Bread)*",
    "- [x] 3 eggs *(Cake, Omelette)*",
    "- [ ] salt to taste",
    "",
  ].join("\n");

  it("splits header lines from items and trims trailing blank header lines", () => {
    const { headerLines, items } = parseShoppingListMarkdown(note);
    expect(headerLines).toEqual(["# Shopping List", "", "Some notes."]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      checked: false,
      amount: 2,
      unit: "cup",
      name: "flour",
      sources: ["Bread"],
    });
    expect(items[1]).toMatchObject({
      checked: true,
      amount: 3,
      name: "eggs",
      sources: ["Cake", "Omelette"],
    });
    expect(items[2]).toMatchObject({
      checked: false,
      amount: 0,
      unit: "",
      original: "salt to taste",
    });
  });

  it("round-trips a note unchanged", () => {
    const { headerLines, items } = parseShoppingListMarkdown(note);
    expect(renderShoppingListMarkdown(headerLines, items)).toBe(
      [
        "# Shopping List",
        "",
        "Some notes.",
        "",
        "- [ ] 2 cups flour *(Bread)*",
        "- [x] 3 eggs *(Cake, Omelette)*",
        "- [ ] salt to taste",
        "",
      ].join("\n"),
    );
  });

  it("renders with no header when the note starts with items", () => {
    expect(
      renderShoppingListMarkdown([], [itemFromLine("1 lb beef", "Chili")]),
    ).toBe("- [ ] 1 lb beef *(Chili)*\n");
  });

  it("handles an empty note", () => {
    expect(parseShoppingListMarkdown("")).toEqual({
      headerLines: [],
      items: [],
    });
  });
});

describe("removeCheckedItems", () => {
  it("drops checked lines, keeps everything else, and counts removals", () => {
    const { content, removed } = removeCheckedItems(
      "# List\n\n- [ ] flour\n- [x] eggs\n- [X] milk\n\n",
    );
    expect(removed).toBe(2);
    expect(content).toBe("# List\n\n- [ ] flour\n");
  });

  it("reports zero when nothing is checked", () => {
    expect(removeCheckedItems("- [ ] flour\n").removed).toBe(0);
  });
});
