import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { RecipeGallery } from "./components/RecipeGallery";
import { loadRecipes } from "./utils/recipeLoader";
import * as c from "./constants";
import type RecipeGrabber from "./main";

export class RecipeGalleryView extends ItemView {
  private plugin: RecipeGrabber;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RecipeGrabber) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return c.VIEW_TYPE_RECIPE_GALLERY;
  }

  getDisplayText(): string {
    return "Recipe Gallery";
  }

  getIcon(): string {
    return "utensils";
  }

  async onOpen(): Promise<void> {
    this.render();

    // Keep the gallery current as notes are created, renamed, modified, or retagged.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.render();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.render();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) this.render();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.render()),
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const recipes = loadRecipes(
      this.app.vault,
      this.app.metadataCache,
      this.plugin.settings.recipeGalleryFolder,
    );

    const container = this.contentEl;
    container.style.padding = "0";
    container.style.overflow = "hidden";

    if (!this.root) {
      this.root = createRoot(container);
    }

    this.root.render(
      <RecipeGallery
        recipes={recipes}
        onOpen={async (path: string) => {
          const abstractFile = this.app.vault.getAbstractFileByPath(path);
          if (abstractFile instanceof TFile) {
            await this.plugin.ensureRecipeNoteCssClass(abstractFile);
            // Open in this leaf and force Reading mode when entering from gallery.
            await this.leaf.setViewState({
              type: "markdown",
              state: { file: abstractFile.path, mode: "preview" },
              active: true,
            });
          }
        }}
      />,
    );
  }
}
