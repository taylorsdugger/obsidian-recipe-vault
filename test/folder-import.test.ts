import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import { makePlugin, resetObsidianStub } from "./helpers/plugin";
import { noticeLog, type TFolder } from "./helpers/obsidian-stub";

const pie = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Apple Pie",
  recipeIngredient: ["6 apples"],
  recipeInstructions: ["Bake it."],
};

const soupCook = ["Simmer @stock{1%l} with @leeks{2}.", ""].join("\n");

/** A plugin wired to a fresh in-memory vault. */
function setup() {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes" });
  plugin.app = makeFakeApp(vault) as any;
  const importFolder = (path: string) =>
    (plugin as any).importRecipesFromFolder(
      vault.getAbstractFileByPath(path) as TFolder,
    ) as Promise<void>;
  return { vault, importFolder };
}

describe("folder import", () => {
  beforeEach(() => resetObsidianStub());

  it("keeps the folder structure inside the recipe save folder", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/Desserts/pie.json", JSON.stringify(pie));
    await vault.seed("Imports/Soups/Winter/Leek Soup.cook", soupCook);
    await vault.seed(
      "Imports/top.json",
      JSON.stringify({ ...pie, name: "Top" }),
    );
    await vault.seed("Imports/readme.md", "not a recipe");

    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toEqual([
      "Recipes/Desserts/Apple Pie.md",
      "Recipes/Soups/Winter/Leek Soup.md",
      "Recipes/Top.md",
    ]);
    const soup = vault.text("Recipes/Soups/Winter/Leek Soup.md");
    expect(soup).toContain("source: cooklang");
    expect(soup).toContain("source_file: Imports/Soups/Winter/Leek Soup.cook");
    expect(soup).toContain("- [ ] 1 l stock");
    expect(noticeLog.at(-1)).toBe("Imported 3 recipes.");
  });

  it("skips everything on a second run", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/pie.json", JSON.stringify(pie));
    await vault.seed("Imports/Leek Soup.cook", soupCook);

    await importFolder("Imports");
    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toEqual([
      "Recipes/Apple Pie.md",
      "Recipes/Leek Soup.md",
    ]);
    expect(noticeLog.at(-1)).toBe(
      "Imported 0 recipes, skipped 2 already imported.",
    );
  });

  it("skips a recipe whose url is already on a note", async () => {
    const { vault, importFolder } = setup();
    await vault.seed(
      "Recipes/My Pie.md",
      "---\nurl: https://example.com/pie\n---\n# My Pie\n",
    );
    await vault.seed(
      "Imports/pie.json",
      JSON.stringify({ ...pie, url: "https://example.com/pie" }),
    );

    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toEqual(["Recipes/My Pie.md"]);
  });

  it("gives each recipe in a multi-recipe file its own key", async () => {
    const { vault, importFolder } = setup();
    await vault.seed(
      "Imports/two.json",
      JSON.stringify([pie, { ...pie, name: "Pear Pie" }]),
    );

    await importFolder("Imports");
    await importFolder("Imports");

    expect(vault.text("Recipes/Apple Pie.md")).toContain(
      "source_file: Imports/two.json#1",
    );
    expect(vault.text("Recipes/Pear Pie.md")).toContain(
      "source_file: Imports/two.json#2",
    );
    expect(vault.paths("Recipes/")).toHaveLength(2);
  });

  it("lists files that fail and still imports the rest", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/good.json", JSON.stringify(pie));
    await vault.seed("Imports/broken.json", "{ nope");
    await vault.seed("Imports/empty.cook", "---\ntitle: Nothing\n---\n");

    await importFolder("Imports");

    expect(vault.paths("Recipes/")).toEqual(["Recipes/Apple Pie.md"]);
    const log = vault.text("Imports/Import errors.md");
    expect(log).toContain(
      "- Imports/broken.json: broken.json isn't valid JSON.",
    );
    expect(log).toContain(
      "- Imports/empty.cook: empty.cook has no ingredients or steps in it.",
    );
    expect(noticeLog.at(-1)).toBe(
      "Imported 1 recipe, 2 files failed (see Imports/Import errors.md).",
    );
  });

  it("says so when the folder has nothing to import", async () => {
    const { vault, importFolder } = setup();
    await vault.seed("Imports/readme.md", "hi");

    await importFolder("Imports");

    expect(noticeLog.at(-1)).toBe("No .json or .cook recipe files in Imports.");
  });
});
