import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
  type PluginSettingsOverride,
} from "./helpers/plugin";
import type { TFile } from "./helpers/obsidian-stub";

const bread = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Gingerbread",
  recipeIngredient: ["250 g honey"],
  recipeInstructions: ["Bake it."],
};

/**
 * A vault with a homepage note that stays the active view no matter what
 * gets opened, like the Homepage plugin with "always apply" on (#28).
 */
async function setup(settings: PluginSettingsOverride = {}) {
  const vault = new FakeVault();
  const homepage = await vault.seed("Home.md", "# Home\n");
  const typed: string[] = [];
  const homepageView = {
    file: homepage as TFile,
    getMode: () => "source",
    editor: {
      replaceSelection: (md: string) => typed.push(md),
      setValue: () => {},
    },
  };
  const app = makeFakeApp(vault);
  const plugin = makePlugin({ folder: "Recipes", saveImg: false, ...settings });
  plugin.app = {
    ...app,
    workspace: { ...app.workspace, getActiveViewOfType: () => homepageView },
  } as any;
  respondWith(htmlWithJsonLd(bread));
  const importUrl = () =>
    (plugin as any).addRecipeToMarkdown("https://example.com/gingerbread");
  return { vault, typed, importUrl };
}

describe("URL import", () => {
  beforeEach(() => resetObsidianStub());

  it("writes into the new note even when another note stays active", async () => {
    const { vault, typed, importUrl } = await setup();

    await importUrl();

    expect(vault.text("Recipes/Gingerbread.md")).toContain("250 g honey");
    expect(vault.text("Home.md")).toBe("# Home\n");
    expect(typed).toEqual([]);
  });

  it("still writes into the open note when saveInActiveFile is on", async () => {
    const { vault, typed, importUrl } = await setup({ saveInActiveFile: true });

    await importUrl();

    expect(vault.paths("Recipes")).toEqual([]);
    expect(typed).toHaveLength(1);
    expect(typed[0]).toContain("250 g honey");
  });
});
