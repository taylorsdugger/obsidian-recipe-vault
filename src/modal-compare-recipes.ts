import { App, Modal, TFile } from "obsidian";
import type { RecipeNote } from "./types/recipe";
import type RecipeVault from "./main";

export class CompareRecipesModal extends Modal {
  private readonly recipes: RecipeNote[];
  private readonly plugin: RecipeVault;

  constructor(app: App, plugin: RecipeVault, recipes: RecipeNote[]) {
    super(app);
    this.plugin = plugin;
    this.recipes = recipes;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("rg-compare-modal");

    contentEl.createEl("h3", { text: "Compare Recipes" });

    // Count how many recipes each ingredient appears in for diff highlighting
    const ingredientCounts = new Map<string, number>();
    for (const recipe of this.recipes) {
      const seen = new Set<string>();
      for (const ing of recipe.ingredients) {
        const key = ing.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          ingredientCounts.set(key, (ingredientCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const grid = contentEl.createDiv({ cls: "compare-modal-grid" });

    for (const recipe of this.recipes) {
      const card = grid.createDiv({ cls: "compare-modal-card" });

      if (recipe.photo) {
        const img = card.createEl("img", {
          cls: "compare-modal-img",
          attr: { src: recipe.photo, alt: recipe.title },
        });
        img.addEventListener("error", () => {
          img.style.display = "none";
          card.createDiv({
            cls: "compare-modal-img-placeholder",
            text: "🍽️",
          });
        });
      } else {
        card.createDiv({ cls: "compare-modal-img-placeholder", text: "🍽️" });
      }

      card.createDiv({ cls: "compare-modal-title", text: recipe.title });

      if (recipe.meal_type.length > 0) {
        const tagsEl = card.createDiv({ cls: "compare-modal-tags" });
        for (const tag of recipe.meal_type) {
          tagsEl.createEl("span", { text: tag, cls: "rg-tag" });
        }
      }

      const meta = card.createDiv({ cls: "compare-modal-meta" });
      if (recipe.cook_time) {
        meta.createEl("span", { text: `⏱ ${recipe.cook_time}` });
      }
      meta.createEl("span", { text: `✓ ${recipe.times_made}×` });

      const openBtn = card.createEl("button", {
        text: "Open →",
        cls: "compare-modal-open-btn",
      });
      openBtn.addEventListener("click", async () => {
        const file = this.app.vault.getAbstractFileByPath(recipe.path);
        if (file instanceof TFile) {
          await this.plugin.ensureRecipeNoteCssClass(file);
          const leaf = this.app.workspace.getLeaf();
          await leaf.setViewState({
            type: "markdown",
            state: { file: file.path, mode: "preview" },
            active: true,
          });
        }
        this.close();
      });

      if (recipe.ingredients.length > 0) {
        card.createEl("h4", {
          text: "Ingredients",
          cls: "compare-modal-ing-label",
        });
        const list = card.createEl("ul", { cls: "compare-modal-ing-list" });
        for (const ing of recipe.ingredients) {
          const key = ing.toLowerCase().trim();
          const count = ingredientCounts.get(key) ?? this.recipes.length;
          list.createEl("li", {
            text: ing,
            cls:
              count < this.recipes.length
                ? "compare-modal-ing unique"
                : "compare-modal-ing",
          });
        }
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
