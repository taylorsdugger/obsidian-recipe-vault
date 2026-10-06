import { describe, expect, it } from "vitest";
import { parseRecipesFromHtml } from "@recipe-vault/core";

import { parseOptions, type TitleCleaning } from "../src/worker/parse-options";
import {
  DEFAULT_SETTINGS,
  parseSettingsPatch,
  readSettings,
} from "../src/worker/settings";

/** A page with one JSON-LD recipe called `name`. */
function page(name: string): string {
  const recipe = JSON.stringify({
    "@type": "Recipe",
    name,
    recipeIngredient: ["1 can chickpeas"],
  });
  return `<!doctype html><html><head><script type="application/ld+json">${recipe}</script></head><body></body></html>`;
}

/** The title an import preview would show, under the given switches. */
function importedTitle(name: string, cleaning: TitleCleaning): unknown {
  const [recipe] = parseRecipesFromHtml(
    page(name),
    new URL("https://example.com/chili"),
    parseOptions(cleaning),
  );
  return recipe?.name;
}

describe("import title cleaning", () => {
  const title = "The Best Easy Vegan Chili";

  it("strips filler words and vegan with both switches on", () => {
    expect(
      importedTitle(title, { stripFillerWords: true, stripVeganWords: true }),
    ).toBe("Chili");
  });

  it("keeps filler words when that switch is off", () => {
    expect(
      importedTitle(title, { stripFillerWords: false, stripVeganWords: true }),
    ).toBe("The Best Easy Chili");
  });

  it("keeps vegan when that switch is off", () => {
    expect(
      importedTitle(title, { stripFillerWords: true, stripVeganWords: false }),
    ).toBe("Vegan Chili");
  });

  it("leaves the title alone with both off", () => {
    expect(
      importedTitle(title, { stripFillerWords: false, stripVeganWords: false }),
    ).toBe(title);
  });
});

describe("readSettings", () => {
  it("gives the defaults for an empty table", () => {
    expect(readSettings(new Map())).toEqual(DEFAULT_SETTINGS);
  });

  it("reads stored values", () => {
    const stored = new Map([
      ["recipe_format", "cooklang"],
      ["strip_filler_words", "false"],
      ["strip_vegan_words", "false"],
    ]);
    expect(readSettings(stored)).toEqual({
      recipeFormat: "cooklang",
      stripFillerWords: false,
      stripVeganWords: false,
    });
  });

  it("falls back to the default for a value it can't read", () => {
    const stored = new Map([
      ["recipe_format", "docx"],
      ["strip_vegan_words", "yes"],
    ]);
    expect(readSettings(stored)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("parseSettingsPatch", () => {
  it("takes any subset", () => {
    expect(parseSettingsPatch({ stripVeganWords: false })).toEqual({
      patch: { stripVeganWords: false },
    });
    expect(
      parseSettingsPatch({ recipeFormat: "cooklang", stripFillerWords: true }),
    ).toEqual({ patch: { recipeFormat: "cooklang", stripFillerWords: true } });
  });

  it("rejects a wrong type", () => {
    expect(parseSettingsPatch({ stripVeganWords: "false" })).toHaveProperty(
      "error",
    );
    expect(parseSettingsPatch({ recipeFormat: "docx" })).toHaveProperty(
      "error",
    );
  });

  it("rejects an empty body", () => {
    expect(parseSettingsPatch({ theme: "dark" })).toHaveProperty("error");
  });
});
