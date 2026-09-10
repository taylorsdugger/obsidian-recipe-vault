import { describe, expect, it } from "vitest";

import { cleanRecipeName } from "../src";

const OPTS = {
  fillerWordsMode: "auto" as const,
  customFillerWords: "",
  filterVeganWords: true,
  filterGlutenFreeWords: true,
};

const clean = (name: string) => cleanRecipeName(name, OPTS);

describe("cleanRecipeName", () => {
  it("strips filler and dietary words", () => {
    expect(clean("Easy Vegan Gluten-Free Dumplings")).toBe("Dumplings");
    expect(clean("The Best Homemade Pizza")).toBe("Pizza");
  });

  /**
   * Stripping the words out of a parenthetical leaves the punctuation behind,
   * and the old rule only removed a group that was empty or whitespace. So a
   * real vault note ended up titled "20 Minute Creamy Quinoa Porridge ()".
   */
  it("removes a bracketed group left with nothing meaningful in it", () => {
    expect(clean("20 Minute Creamy Quinoa Porridge (Vegan, Gluten-Free)")).toBe(
      "20 Minute Creamy Quinoa Porridge",
    );
    // The separator inside varies by site; none of them should survive.
    expect(clean("Porridge (vegan + gluten-free)")).toBe("Porridge");
    expect(clean("Soup (Dairy-Free / Vegan)")).toBe("Soup");
    expect(clean("Brownies (Easy, Healthy)")).toBe("Brownies");
    // Square and curly brackets too, which were never handled at all.
    expect(clean("Cake [Vegan]")).toBe("Cake");
    expect(clean("Cake {Vegan}")).toBe("Cake");
  });

  it("keeps a group that still says something", () => {
    expect(clean("Chili (Instant Pot)")).toBe("Chili (Instant Pot)");
    expect(clean("Pasta (Serves 4)")).toBe("Pasta (Serves 4)");
    // Only the emptied group goes; the rest of the title is untouched.
    expect(clean("Curry (Vegan) with Rice")).toBe("Curry with Rice");
  });

  it("leaves an ordinary title alone", () => {
    expect(clean("Plain Old Soup")).toBe("Plain Old Soup");
    expect(clean("Roasted Beet Hummus")).toBe("Roasted Beet Hummus");
  });

  it("falls back to the original when stripping removes everything", () => {
    expect(clean("Vegan")).toBe("Vegan");
    expect(clean("(Vegan)")).toBe("(Vegan)");
  });
});
