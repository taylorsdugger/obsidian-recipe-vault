import { TextFileView, WorkspaceLeaf, setIcon } from "obsidian";
import { createRoot } from "react-dom/client";
import {
  cooklangToJsonLd,
  parseCooklang,
  readRecipeVaultState,
} from "@recipe-vault/core";
import { CooklangRecipe } from "./components/CooklangRecipe";
import * as c from "./constants";
import type RecipeVault from "./main";
import { cooklangSiblingImage } from "./utils/recipeLoader";

type CooklangViewMode = "preview" | "source";

/**
 * Opens `.cook` files. Reading mode lays the recipe out like a recipe note;
 * source mode is a plain text editor over the file.
 *
 * Ticked ingredients live here, not in the file, since Cooklang has nowhere
 * to keep them. "Add checked to shopping list" reads them from the view.
 */
export class CooklangView extends TextFileView {
  private plugin: RecipeVault;
  private root: ReturnType<typeof createRoot> | null = null;
  private mode: CooklangViewMode = "preview";
  private modeAction: HTMLElement;
  /** Ticked ingredients, by their place in the ingredient list. */
  private checked = new Set<number>();

  constructor(leaf: WorkspaceLeaf, plugin: RecipeVault) {
    super(leaf);
    this.plugin = plugin;
    // Makes a markdown note from this file and leaves the file alone.
    this.addAction("file-plus", "Make a markdown copy", () => this.import());
    this.modeAction = this.addAction("pencil", "Edit", () =>
      this.setMode(this.mode === "preview" ? "source" : "preview"),
    );
  }

  getViewType(): string {
    return c.VIEW_TYPE_COOKLANG;
  }

  getIcon(): string {
    return "chef-hat";
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    // A different file opens in reading mode, like a markdown note would.
    if (clear) {
      this.mode = "preview";
      this.checked = new Set();
    }
    this.render();
  }

  clear(): void {
    this.data = "";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), mode: this.mode };
  }

  async setState(
    state: unknown,
    result: Parameters<TextFileView["setState"]>[1],
  ): Promise<void> {
    const mode = (state as { mode?: unknown } | null)?.mode;
    if (mode === "preview" || mode === "source") this.mode = mode;
    await super.setState(state, result);
    this.render();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private setMode(mode: CooklangViewMode): void {
    this.mode = mode;
    this.render();
    // Record the mode in the leaf's history so going back returns to it.
    this.app.workspace.requestSaveLayout();
  }

  private import(): void {
    if (this.file) void this.plugin.importRecipeFromFile(this.file);
  }

  /** The ticked ingredient lines, in list order. */
  checkedIngredients(): string[] {
    const { ingredients } = parseCooklang(this.data);
    return [...this.checked]
      .sort((a, b) => a - b)
      .map((i) => ingredients[i])
      .filter(Boolean)
      .map((ingredient) => {
        const line = [ingredient.quantity, ingredient.unit, ingredient.name]
          .filter(Boolean)
          .join(" ");
        return ingredient.prep ? `${line}, ${ingredient.prep}` : line;
      });
  }

  clearChecked(): void {
    this.checked = new Set();
    this.render();
  }

  private toggle(index: number): void {
    const next = new Set(this.checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this.checked = next;
    this.render();
  }

  private async addCheckedToList(): Promise<void> {
    if (!this.file) return;
    const lines = this.checkedIngredients();
    if (lines.length === 0) return;
    await this.plugin.addToShoppingList(lines, this.file.basename);
    this.clearChecked();
  }

  private render(): void {
    const editing = this.mode === "source";
    setIcon(this.modeAction, editing ? "book-open" : "pencil");
    this.modeAction.setAttribute("aria-label", editing ? "Read" : "Edit");

    const container = this.contentEl;
    container.addClass("cooklang-view");
    if (!this.root) this.root = createRoot(container);

    if (editing) {
      this.root.render(
        <textarea
          className="cooklang-source-editor"
          spellcheck={false}
          value={this.data}
          onInput={(event) => {
            this.data = event.currentTarget.value;
            this.requestSave();
          }}
        />,
      );
      return;
    }

    const recipe = parseCooklang(this.data);
    const summary = cooklangToJsonLd(recipe, { name: this.file?.basename });
    const linked =
      typeof summary.image === "string" ? summary.image : undefined;
    const sibling = this.file
      ? cooklangSiblingImage(this.app.vault, this.file)
      : null;
    const file = this.file;

    this.root.render(
      <CooklangRecipe
        recipe={recipe}
        summary={summary}
        history={readRecipeVaultState(summary)}
        imageSrc={sibling ? this.app.vault.getResourcePath(sibling) : linked}
        checked={this.checked}
        onToggle={(i) => this.toggle(i)}
        onMarkMade={() => {
          if (file) void this.plugin.markRecipeMade(file);
        }}
        onAddToList={() => void this.addCheckedToList()}
        onEdit={() => this.setMode("source")}
      />,
    );
  }
}
