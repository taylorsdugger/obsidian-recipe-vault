import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import { makePlugin, resetObsidianStub } from "./helpers/plugin";
import { MarkdownView } from "./helpers/obsidian-stub";

/**
 * A view with the bits of Obsidian's properties panel the plugin reaches
 * for. `setCollapse` and `onMarkdownFold` behave like Obsidian's: one sets
 * the state, the other saves the note's folds.
 */
function fakeView(file: unknown) {
  const view = Object.create(MarkdownView.prototype);
  view.file = file;
  view.saves = 0;
  view.metadataEditor = {
    collapsed: false,
    setCollapse(collapsed: boolean) {
      this.collapsed = collapsed;
    },
  };
  view.onMarkdownFold = () => view.saves++;
  return view;
}

async function setup(settings = {}) {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes", ...settings });
  plugin.app = makeFakeApp(vault) as any;
  const recipe = await vault.seed(
    "Recipes/Curry.md",
    "---\ncssclasses: recipe-note\ncalories: 530\n---\n# Curry\n",
  );
  const other = await vault.seed("Notes/Todo.md", "---\ntags: todo\n---\n");
  const collapse = (view: unknown) =>
    (plugin as any).collapseRecipeProperties(view);
  return { vault, recipe, other, collapse };
}

describe("collapsed properties", () => {
  beforeEach(() => resetObsidianStub());

  it("folds a recipe's properties when it opens, and saves that", async () => {
    const { recipe, collapse } = await setup();
    const view = fakeView(recipe);
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(true);
    expect(view.saves).toBe(1);
  });

  it("leaves them open once you open them, until the recipe opens again", async () => {
    const { recipe, other, collapse } = await setup();
    const view = fakeView(recipe);
    collapse(view);
    view.metadataEditor.collapsed = false; // clicked Properties
    collapse(view); // a resize, an edit, a mode switch
    expect(view.metadataEditor.collapsed).toBe(false);

    view.file = other;
    collapse(view);
    view.file = recipe;
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(true);
  });

  it("leaves other notes alone", async () => {
    const { other, collapse } = await setup();
    const view = fakeView(other);
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(false);
    expect(view.saves).toBe(0);
  });

  it("does nothing with the setting off", async () => {
    const { recipe, collapse } = await setup({
      collapseRecipeProperties: false,
    });
    const view = fakeView(recipe);
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(false);
  });

  it("does nothing if Obsidian's panel isn't there to fold", async () => {
    const { recipe, collapse } = await setup();
    const view = fakeView(recipe);
    view.metadataEditor = undefined;
    expect(() => collapse(view)).not.toThrow();
    expect(view.saves).toBe(0);
  });

  it("folds a note that becomes a recipe while it's open", async () => {
    const { vault, collapse } = await setup();
    // An import opens an empty note, then writes the recipe into it.
    const fresh = await vault.seed("Recipes/Soup.md", "");
    const view = fakeView(fresh);
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(false);

    await vault.modify(fresh, "---\ncssclasses: recipe-note\n---\n# Soup\n");
    collapse(view);
    expect(view.metadataEditor.collapsed).toBe(true);
  });
});
