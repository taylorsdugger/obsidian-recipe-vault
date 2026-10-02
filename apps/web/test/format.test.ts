import { describe, expect, it } from "vitest";

import {
  bareUrl,
  madeToday,
  mealAndTime,
  pdfName,
  sourceHost,
} from "../src/client/format";
import { addDays, dateKey } from "../src/client/week";

/**
 * What greys out "Mark made". The trap is the same one the week maths has: a
 * date written in UTC is not the date you are standing in, and this has to say
 * "already done" for a dinner cooked this evening either way.
 */
describe("madeToday", () => {
  const today = dateKey(new Date());

  it("is true for today", () => {
    expect(madeToday(today)).toBe(true);
  });

  it("is false for a recipe never made, or made before today", () => {
    expect(madeToday(null)).toBe(false);
    expect(madeToday(dateKey(addDays(new Date(), -1)))).toBe(false);
    expect(madeToday("2024-01-01")).toBe(false);
  });

  it("counts a UTC-stamped tomorrow as today", () => {
    // What the Worker used to write for an evening west of Greenwich. The
    // button has to stay off, or the tap that just happened looks like it
    // didn't take.
    expect(madeToday(dateKey(addDays(new Date(), 1)))).toBe(true);
  });
});

describe("sourceHost", () => {
  it("drops the scheme, path and www", () => {
    expect(sourceHost("https://www.example-kitchen.com/curry?x=1")).toBe(
      "example-kitchen.com",
    );
  });

  it("hands back what it can't parse", () => {
    expect(sourceHost("not a url")).toBe("not a url");
  });
});

describe("mealAndTime", () => {
  it("joins what's there", () => {
    expect(mealAndTime({ mealType: "dinner,lunch", cookTime: "40 min" })).toBe(
      "dinner, lunch · 40 min",
    );
    expect(mealAndTime({ mealType: null, cookTime: "40 min" })).toBe("40 min");
    expect(mealAndTime({ mealType: null, cookTime: null })).toBe("");
  });
});

describe("bareUrl", () => {
  it("keeps the path and drops the scheme, www and trailing slash", () => {
    expect(bareUrl("https://www.example-kitchen.com/crispy-curry/")).toBe(
      "example-kitchen.com/crispy-curry",
    );
    expect(bareUrl("http://example.com/r?id=4")).toBe("example.com/r?id=4");
  });
});

describe("pdfName", () => {
  it("keeps the recipe's name and drops what a file name can't hold", () => {
    expect(pdfName("Crispy Chickpea & Spinach Curry")).toBe(
      "Crispy Chickpea & Spinach Curry",
    );
    expect(pdfName('Mac & Cheese: "Baked" 1/2 batch')).toBe(
      "Mac & Cheese Baked 1 2 batch",
    );
  });

  it("falls back when nothing is left", () => {
    expect(pdfName("  ///  ")).toBe("Recipe");
  });
});
