import { App, Modal } from "obsidian";
import type { RecipeNote } from "./types/recipe";

export class CompareRecipesModal extends Modal {
  private readonly recipes: RecipeNote[];

  constructor(app: App, recipes: RecipeNote[]) {
    super(app);
    this.recipes = recipes;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Compare Recipes" });
    contentEl.createEl("p", {
      text: `${this.recipes.length} recipes selected`,
      cls: "setting-item-description",
    });

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

      if (recipe.cook_time) {
        card.createDiv({
          cls: "compare-modal-meta",
          text: `⏱ ${recipe.cook_time}`,
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
