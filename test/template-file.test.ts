import { beforeEach, describe, expect, it } from "vitest";

import { getRecipeFiles } from "../src/utils/recipeLoader";
import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import {
  makePlugin,
  resetObsidianStub,
  type PluginSettingsOverride,
} from "./helpers/plugin";
import { noticeLog, type TFile } from "./helpers/obsidian-stub";

const pie = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Apple Pie",
  image: "https://example.com/pie.jpg",
  recipeIngredient: ["6 apples"],
  recipeInstructions: ["Bake it."],
};

/** A template like the one in #24, with the photo under `image_url`. */
const IMAGE_URL_TEMPLATE = [
  "---",
  "tags:",
  "- recipe",
  "cssclasses: recipe-note",
  "cook_time: {{magicTime totalTime}}",
  'image_url: "{{image}}"',
  "---",
  "",
  "# {{{name}}}",
  "",
  "From my template file.",
  "",
  "### Ingredients",
  "",
  "{{#each recipeIngredient}}",
  "- [ ] {{{this}}}",
  "{{/each}}",
  "",
].join("\n");

function setup(settings: PluginSettingsOverride = {}) {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes", ...settings });
  plugin.app = makeFakeApp(vault) as any;
  const save = async () => {
    const file = (await (plugin as any).saveParsedRecipe(structuredClone(pie), {
      quiet: true,
    })) as TFile;
    return vault.text(file.path);
  };
  return { vault, plugin, save };
}

describe("template file", () => {
  beforeEach(() => resetObsidianStub());

  it("renders new notes from the template file", async () => {
    const { vault, save } = setup({
      recipeTemplateFile: "Templates/Recipe",
      photoProperty: "image_url",
    });
    await vault.seed("Templates/Recipe.md", IMAGE_URL_TEMPLATE);

    const note = await save();
    expect(note).toContain("From my template file.");
    expect(note).toContain('image_url: "https://example.com/pie.jpg"');
    // #24: no second photo property on top of the template's own.
    expect(note).not.toMatch(/^photo:/m);
  });

  it("falls back to the settings template when the file is gone", async () => {
    const { save } = setup({ recipeTemplateFile: "Templates/Missing.md" });

    const note = await save();
    expect(note).toContain('photo: "https://example.com/pie.jpg"');
    expect(noticeLog.some((n) => n.includes("Templates/Missing.md"))).toBe(
      true,
    );
  });

  it("creates a template file from the settings template", async () => {
    const { vault, plugin } = setup({ recipeTemplate: "# {{name}}\n" });

    expect(await plugin.createTemplateFile()).toBe("Recipe Vault template.md");
    expect(vault.text("Recipe Vault template.md")).toBe("# {{name}}\n");
    expect(plugin.settings.recipeTemplateFile).toBe("Recipe Vault template.md");

    // A second one doesn't overwrite the first.
    expect(await plugin.createTemplateFile()).toBe(
      "Recipe Vault template (2).md",
    );
  });

  it("doesn't treat the template file as a recipe", async () => {
    const { vault, plugin } = setup({
      recipeTemplateFile: "Recipes/Template.md",
    });
    const template = await vault.seed(
      "Recipes/Template.md",
      IMAGE_URL_TEMPLATE,
    );
    await vault.seed("Recipes/Pie.md", IMAGE_URL_TEMPLATE);

    expect((plugin as any).isRecipeFile(template)).toBe(false);
    expect(
      getRecipeFiles(vault as any, "Recipes", plugin.templateFilePath()).map(
        (f) => f.path,
      ),
    ).toEqual(["Recipes/Pie.md"]);
  });
});
