import { describe, expect, it } from "vitest";

import {
  formatIngredientAmount,
  fromBaseAmount,
  normalizeIngredientUnit,
  parseShoppingLine,
  pluraliseUnit,
  toBaseAmount,
} from "../src";

/**
 * Unit tests for the shopping-list math. These five helpers back the "add
 * checked ingredients to shopping list" merge flow: parse a line → convert to
 * a base unit → sum → format back.
 */
const parseLine = parseShoppingLine;
const unit = normalizeIngredientUnit;
const fmt = formatIngredientAmount;
const toBase = toBaseAmount;
const fromBase = fromBaseAmount;

describe("parseShoppingLine", () => {
  it("parses amount, unit, and name", () => {
    expect(parseLine("2 cups flour")).toEqual({
      amount: 2,
      unit: "cup",
      name: "flour",
      sources: [],
    });
  });

  it("parses a mixed number + fraction amount", () => {
    expect(parseLine("1 1/2 cups sugar")).toMatchObject({
      amount: 1.5,
      unit: "cup",
      name: "sugar",
    });
  });

  it("normalizes a unit with a trailing period", () => {
    expect(parseLine("2 tbsp. olive oil")).toMatchObject({
      amount: 2,
      unit: "tbsp",
      name: "olive oil",
    });
  });

  it("handles a count with no unit", () => {
    expect(parseLine("3 eggs")).toMatchObject({
      amount: 3,
      unit: "",
      name: "eggs",
    });
  });

  it("handles a line with no amount or unit", () => {
    expect(parseLine("salt to taste")).toMatchObject({
      amount: 0,
      unit: "",
      name: "salt to taste",
    });
  });

  it("strips a trailing comma descriptor from the name", () => {
    expect(parseLine("1 onion, chopped")).toMatchObject({
      amount: 1,
      unit: "",
      name: "onion",
    });
  });

  it("strips a parenthetical prep note from the name", () => {
    expect(parseLine("2 cloves garlic (minced)")).toMatchObject({
      amount: 2,
      unit: "clove",
      name: "garlic",
    });
  });

  /*
   * WP Recipe Maker publishes its ingredient-notes field already wrapped in
   * parentheses, so a note that itself contains them comes out of the site's
   * own JSON-LD as "((minced))". Real lines, from minimalistbaker.com.
   */
  it("strips a doubled parenthetical without leaving the closer behind", () => {
    // "medium" is a size, not a unit, so it stays on the name - same as it
    // does for "1 medium shallot" with no note at all. The point here is the
    // stranded ")", which is what reached the shopping list.
    expect(parseLine("1 medium shallot ((minced))")).toMatchObject({
      amount: 1,
      name: "medium shallot",
    });
    expect(
      parseLine(
        "1 ½ Tbsp coconut oil  ((or avocado or grape seed oil // sub water if avoiding oil))",
      ),
    ).toMatchObject({ amount: 1.5, unit: "tbsp", name: "coconut oil" });
  });

  it("survives a parenthesis that never closes", () => {
    // A note truncated mid-way through by the source site.
    expect(parseLine("2 cups flour (sifted")).toMatchObject({
      amount: 2,
      unit: "cup",
      name: "flour",
    });
  });

  it("keeps a bracketed amount that is part of the ingredient", () => {
    // "2 (14-ounce) cans" - the parenthetical is the can size, and dropping it
    // is right for the name, but the line must not lose the rest of it.
    expect(parseLine("2 (14-ounce) cans light coconut milk")).toMatchObject({
      amount: 2,
      name: "cans light coconut milk",
    });
  });

  it("extracts a single *(source)* annotation", () => {
    expect(parseLine("2 cups flour *(Dumplings)*")).toMatchObject({
      name: "flour",
      sources: ["Dumplings"],
    });
  });

  it("extracts multiple comma-separated sources", () => {
    expect(parseLine("1 tsp salt *(Soup, Broth)*")).toMatchObject({
      name: "salt",
      sources: ["Soup", "Broth"],
    });
  });

  it("returns null for a blank line", () => {
    expect(parseLine("   ")).toBeNull();
  });

  it("parses a leading unicode fraction", () => {
    expect(parseLine("½ tsp salt")).toMatchObject({
      amount: 0.5,
      unit: "tsp",
      name: "salt",
    });
  });

  it("parses a mixed whole + unicode fraction", () => {
    expect(parseLine("1½ cups sugar")).toMatchObject({
      amount: 1.5,
      unit: "cup",
      name: "sugar",
    });
  });
});

describe("normalizeIngredientUnit", () => {
  it("maps plural/abbreviated forms to a canonical unit", () => {
    expect(unit("Tablespoons")).toBe("tbsp");
    expect(unit("cups")).toBe("cup");
    expect(unit("Cloves")).toBe("clove");
    expect(unit("pounds")).toBe("lb");
  });

  it("strips a trailing period and is case-insensitive", () => {
    expect(unit("tsp.")).toBe("tsp");
    expect(unit("C")).toBe("cup");
  });

  it("returns an empty string for an unrecognized unit", () => {
    expect(unit("xyz")).toBe("");
    expect(unit("")).toBe("");
  });
});

describe("formatIngredientAmount", () => {
  it("returns just the unit when the amount is zero", () => {
    expect(fmt(0, "cup")).toBe("cup");
  });

  it("formats a whole number with a unit", () => {
    expect(fmt(2, "cup")).toBe("2 cups");
  });

  it("renders mixed numbers with a unicode fraction", () => {
    expect(fmt(1.5, "cup")).toBe("1½ cups");
    expect(fmt(2.75, "lb")).toBe("2¾ lb");
  });

  it("renders a bare fraction, with or without a unit", () => {
    expect(fmt(0.5, "tsp")).toBe("½ tsp");
    expect(fmt(0.25, "")).toBe("¼");
  });

  it("snaps a near-third to ⅓", () => {
    expect(fmt(1 / 3, "cup")).toBe("⅓ cup");
  });

  it("formats a whole number with no unit", () => {
    expect(fmt(3, "")).toBe("3");
  });
});

describe("toBaseAmount / fromBaseAmount", () => {
  it("converts volume units to a tsp base", () => {
    expect(toBase(1, "cup")).toEqual({ base: 48, family: "volume" });
  });

  it("converts weight units to a gram base", () => {
    expect(toBase(1, "lb")).toEqual({ base: 453.6, family: "weight" });
  });

  it("returns null for a unitless / unknown amount", () => {
    expect(toBase(2, "")).toBeNull();
  });

  it("round-trips a base amount back to a readable unit", () => {
    expect(fromBase(48, "volume")).toEqual({ amount: 1, unit: "cup" });
    expect(fromBase(453.6, "weight")).toEqual({ amount: 1, unit: "lb" });
  });

  it("sums compatible volumes across units end-to-end", () => {
    // 1 cup + 2 tbsp = 48 + 6 = 54 tsp → 1.125 cup → "1⅛ cups"
    const a = toBase(1, "cup")!;
    const b = toBase(2, "tbsp")!;
    expect(a.family).toBe(b.family);
    const sum = fromBase(a.base + b.base, a.family);
    expect(sum).toEqual({ amount: 54 / 48, unit: "cup" });
    expect(fmt(sum.amount, sum.unit)).toBe("1⅛ cups");
  });
});

describe("plural units survive a round trip", () => {
  // Every spelled-out unit gets pluralised on the way into a note, so
  // `normalizeIngredientUnit` has to map each plural back on the way out.
  // Miss one - "handfuls" was missing - and the amount stops parsing: the
  // whole "2 handfuls spinach" becomes a nameless line with no quantity.
  const WORD_UNITS = [
    "cup",
    "clove",
    "slice",
    "piece",
    "can",
    "package",
    "bunch",
    "pinch",
    "sprig",
    "head",
    "handful",
    "stalk",
  ];

  it.each(WORD_UNITS)("reads back '2 %ss spinach'", (unit) => {
    const line = `${formatIngredientAmount(2, unit)} spinach`;
    expect(line).toBe(`2 ${pluraliseUnit(unit, 2)} spinach`);

    const parsed = parseShoppingLine(line);
    expect(parsed).toMatchObject({ amount: 2, unit, name: "spinach" });
  });

  it("leaves abbreviations alone", () => {
    for (const unit of ["tsp", "tbsp", "oz", "lb", "g", "kg", "ml", "l"]) {
      expect(formatIngredientAmount(3, unit)).toBe(`3 ${unit}`);
      expect(parseShoppingLine(`3 ${unit} salt`)).toMatchObject({ unit });
    }
  });

  it("stays singular at one or less", () => {
    expect(formatIngredientAmount(1, "cup")).toBe("1 cup");
    expect(formatIngredientAmount(0.5, "cup")).toBe("½ cup");
  });
});
