import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import { makePlugin, resetObsidianStub } from "./helpers/plugin";
import { noticeLog, type TFile, type TFolder } from "./helpers/obsidian-stub";
import { loadRecipes } from "../src/utils/recipeLoader";

const pie = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Apple Pie",
  url: "https://example.com/pie",
  recipeIngredient: ["6 apples", "1 pie crust"],
  recipeInstructions: ["Slice the apples into the pie crust.", "Bake it."],
};

const soupCook = [
  "Simmer @stock{1%l} with @leeks{2} in a #pot for ~{20%minutes}.",
  "",
].join("\n");

/** A plugin set to save new recipes as Cooklang, on a fresh vault. */
function setup() {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes", recipeFormat: "cooklang" });
  const app = makeFakeApp(vault);
  plugin.app = app as any;
  (plugin as any).manifest = { id: "recipe-vault" };
  const importFolder = (path: string) =>
    (plugin as any).importRecipesFromFolder(
      vault.getAbstractFileByPath(path) as TFolder,
    ) as Promise<void>;
  return { vault, plugin, app, importFolder };
}

describe("saving new recipes as Cooklang", () => {
  beforeEach(() => resetObsidianStub());

  it("writes .cook files from a folder import", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/pie.json", JSON.stringify(pie));
    await vault.seed("Imports/Soups/Leek Soup.cook", soupCook);

    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toEqual([
      "Recipes/Apple Pie.cook",
      "Recipes/Soups/Leek Soup.cook",
    ]);
    expect(vault.text("Recipes/Apple Pie.cook")).toBe(
      [
        "---",
        "title: Apple Pie",
        "source: https://example.com/pie",
        "source file: Imports/pie.json",
        "---",
        "",
        "Slice the @apples{6} into the @pie crust{1}.",
        "",
        "Bake it.",
        "",
      ].join("\n"),
    );
    // A .cook file comes across as written, cookware and timers included.
    expect(vault.text("Recipes/Soups/Leek Soup.cook")).toBe(
      `---\nsource file: Imports/Soups/Leek Soup.cook\n---\n\n${soupCook}`,
    );
    expect(noticeLog.at(-1)).toBe("Imported 2 recipes.");
  });

  it("skips .cook files it already made on a second run", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/pie.json", JSON.stringify(pie));
    await vault.seed("Imports/Leek Soup.cook", soupCook);

    await importFolder("Imports");
    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toHaveLength(2);
    expect(noticeLog.at(-1)).toBe(
      "Imported 0 recipes, skipped 2 already imported.",
    );
  });

  it("starts a new recipe as a .cook file open in the editor", async () => {
    const { vault, plugin, app } = setup();

    await (plugin as any).createRecipeStub("Weeknight Dal");

    expect(vault.text("Recipes/Weeknight Dal.cook")).toBe(
      "---\ntitle: Weeknight Dal\n---\n\n",
    );
    expect(app.workspace.opened).toEqual([
      {
        type: "recipe-vault-cooklang-view",
        state: { file: "Recipes/Weeknight Dal.cook", mode: "source" },
        active: true,
      },
    ]);
  });

  it("marks a .cook file as made in its own front matter", async () => {
    const { vault, plugin } = setup();
    const file = await vault.seed(
      "Recipes/Leek Soup.cook",
      "---\ntitle: Leek Soup\ntimes made: 2\n---\n\n" + soupCook,
    );

    await plugin.markRecipeMade(file as any);

    const text = vault.text("Recipes/Leek Soup.cook");
    expect(text).toContain("times made: 3");
    expect(text).toMatch(/last made: \d{4}-\d{2}-\d{2}/);
    expect(text.endsWith(soupCook)).toBe(true);
  });
});

describe("the gallery with .cook files", () => {
  beforeEach(() => {
    resetObsidianStub();
    // The index saves itself on a window timer.
    (globalThis as any).window ??= globalThis;
  });

  it("shows notes and .cook files side by side", async () => {
    const { vault, plugin } = setup();
    await vault.seed(
      "Recipes/Apple Pie.md",
      "---\nmeal_type: dessert\n---\n# Apple Pie\n",
    );
    const soup = await vault.seed(
      "Recipes/Leek Soup.cook",
      "---\ncourse: dinner\ntime: 45 minutes\ntimes made: 4\n---\n\n" + soupCook,
    );
    (vault as any).getResourcePath = (file: TFile) => `app://${file.path}`;

    await (plugin as any).indexRecipeFile(soup);
    const recipes = loadRecipes(
      vault as any,
      plugin.app.metadataCache,
      "Recipes",
      (path) => plugin.getIngredients(path),
      (path) => plugin.getCooklangInfo(path),
    );

    expect(recipes.map((r) => [r.title, r.meal_type, r.times_made])).toEqual([
      ["Apple Pie", ["dessert"], 0],
      ["Leek Soup", ["dinner"], 4],
    ]);
    expect(recipes[1]).toMatchObject({
      cook_time_mins: 45,
      ingredients: ["1 l stock", "2 leeks"],
    });
  });
});
