import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import { makePlugin, resetObsidianStub } from "./helpers/plugin";
import type { TFolder } from "./helpers/obsidian-stub";

/** A recipe file the way a page would hand it over, nutrition and all. */
const curry = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Chickpea Curry",
  recipeYield: ["4"],
  recipeIngredient: ["1 can chickpeas"],
  recipeInstructions: ["Cook it."],
  nutrition: {
    "@type": "NutritionInformation",
    calories: "530 kcal",
    proteinContent: "17 g",
    servingSize: "1 bowl",
  },
};

async function importCurry(settings: Record<string, unknown>) {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes", ...settings });
  plugin.app = makeFakeApp(vault) as any;
  await vault.seed("Imports/curry.json", JSON.stringify(curry));
  await (plugin as any).importRecipesFromFolder(
    vault.getAbstractFileByPath("Imports") as TFolder,
  );
  const [path] = vault.paths("Recipes/");
  return vault.text(path);
}

describe("the Show nutrition setting", () => {
  beforeEach(() => resetObsidianStub());

  it("is off unless someone turns it on", () => {
    expect(makePlugin().settings.showNutrition).toBe(false);
  });

  it("keeps nutrition out of imported notes while it's off", async () => {
    const md = await importCurry({});
    expect(md).not.toContain("calories");
    expect(md).not.toContain("serving_size");
  });

  it("writes it in once it's on", async () => {
    const md = await importCurry({ showNutrition: true });
    expect(md).toContain("calories: 530");
    expect(md).toContain("serving_size: 1 bowl");
  });

  it("does the same for .cook files", async () => {
    const off = await importCurry({ recipeFormat: "cooklang" });
    expect(off).not.toContain("calories");
    const on = await importCurry({
      recipeFormat: "cooklang",
      showNutrition: true,
    });
    expect(on).toContain("calories: 530");
  });
});
