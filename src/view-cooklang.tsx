import { Keymap, TextFileView, WorkspaceLeaf, setIcon } from "obsidian";
import type { Menu } from "obsidian";
import type { CooklangToken } from "@recipe-vault/core";
import { createRoot } from "react-dom/client";
import {
  cooklangToJsonLd,
  parseCooklang,
  readRecipeVaultState,
} from "@recipe-vault/core";
import {
  CooklangRecipe,
  amountText,
  ingredientText,
} from "./components/CooklangRecipe";
import { CookModeModal } from "./modal-cook";
import { tabScrollTop } from "./recipe-note-layout";
import * as c from "./constants";
import type RecipeVault from "./main";
import {
  cooklangPhotoFile,
  resolveRecipeReference,
} from "./utils/recipeLoader";

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
  /** The Kitchen layout's Ingredients / Steps switch. */
  private tab: "ingredients" | "steps" = "ingredients";
  /** Where each Kitchen tab was scrolled to when it was last left. */
  private tabScroll: Partial<Record<"ingredients" | "steps", number>> = {};
  /** The layout the last render drew, so a resize only re-renders on a change. */
  private layout: "rail" | "kitchen" = "rail";

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

  /** The view's "more options" menu, alongside Obsidian's own items. */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const file = this.file;
    if (!file) return;
    menu.addItem((item) =>
      item
        .setTitle("Export recipe as JSON-LD")
        .setIcon("braces")
        .onClick(() => void this.plugin.exportRecipe(file, "jsonld")),
    );
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
      this.tab = "ingredients";
      this.tabScroll = {};
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

  /** Whichever of the recipe and the view is the one scrolling. */
  private scroller(): HTMLElement {
    const root = this.contentEl.querySelector<HTMLElement>(".cooklang-recipe");
    return root && root.scrollHeight > root.clientHeight
      ? root
      : this.contentEl;
  }

  private setTab(tab: "ingredients" | "steps"): void {
    if (tab === this.tab) return;
    this.tabScroll[this.tab] = this.scroller().scrollTop;
    this.tab = tab;
    this.render();
    window.requestAnimationFrame(() => {
      const scroller = this.scroller();
      const role = tab === "ingredients" ? "ingredients" : "instructions";
      scroller.scrollTop = tabScrollTop(
        scroller,
        this.contentEl.querySelector(`[data-recipe-section="${role}"]`),
        this.tabScroll[tab],
        this.contentEl.querySelector<HTMLElement>(".recipe-tabs")
          ?.offsetHeight ?? 0,
      );
    });
  }

  /** Re-render after the layout setting changes. */
  refreshLayout(): void {
    this.render();
  }

  /** A narrow enough pane gets the Kitchen layout, so a resize can switch it. */
  onResize(): void {
    if (this.layoutKind() !== this.layout) this.render();
  }

  private layoutKind(): "rail" | "kitchen" {
    const width = this.contentEl.clientWidth;
    return width === 0 ? this.layout : this.plugin.recipeLayoutKind(width);
  }

  /** The steps one at a time, with each step's own ingredients beside it. */
  openCookMode(): void {
    const recipe = parseCooklang(this.data);
    const steps = recipe.sections.flatMap((section) =>
      section.steps.map((step) => {
        // A .cook step says exactly which ingredients it uses, so there's
        // nothing to guess, unlike a note's steps.
        const uses = step.tokens
          .filter(
            (t): t is Extract<CooklangToken, { type: "ingredient" }> =>
              t.type === "ingredient",
          )
          .map((t) => [amountText(t), t.name].filter(Boolean).join(" "));
        return {
          text: step.text,
          group: section.name,
          uses: [...new Set(uses)],
        };
      }),
    );
    if (steps.length === 0) return;
    const file = this.file;
    new CookModeModal(this.app, {
      title: file?.basename ?? "Recipe",
      steps,
      ingredients: recipe.ingredients.map(ingredientText),
      renderText: (text, el) => el.setText(text),
      onMarkMade: file
        ? () => void this.plugin.markRecipeMade(file)
        : undefined,
    }).open();
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

    this.layout = this.layoutKind();
    const recipe = parseCooklang(this.data);
    const summary = cooklangToJsonLd(recipe, { name: this.file?.basename });
    const linked =
      typeof summary.image === "string" ? summary.image : undefined;
    // Next to the file, or in the image folder its `image:` points at.
    const imageMeta = recipe.metadata.image;
    const local = this.file
      ? cooklangPhotoFile(
          this.app.vault,
          this.file,
          (Array.isArray(imageMeta) ? imageMeta[0] : imageMeta) ?? "",
        )
      : null;
    const file = this.file;
    const linkFor = (reference: string): string | null =>
      file
        ? resolveRecipeReference(
            this.app.vault,
            file,
            reference,
            this.plugin.getGalleryFolder(),
            (name) =>
              this.app.metadataCache.getFirstLinkpathDest(name, file.path),
          )?.path ?? null
        : null;

    this.root.render(
      <CooklangRecipe
        recipe={recipe}
        summary={summary}
        history={readRecipeVaultState(summary)}
        imageSrc={local ? this.app.vault.getResourcePath(local) : linked}
        checked={this.checked}
        onToggle={(i) => this.toggle(i)}
        onMarkMade={() => {
          if (file) void this.plugin.markRecipeMade(file);
        }}
        onAddToList={() => void this.addCheckedToList()}
        onEdit={() => this.setMode("source")}
        onCook={() => this.openCookMode()}
        layout={this.layout}
        tab={this.tab}
        onTab={(tab) => this.setTab(tab)}
        linkFor={linkFor}
        onOpenLink={(path, event) => {
          // Cmd/Ctrl-click opens it in a new tab, like any other link.
          void this.app.workspace.openLinkText(
            path,
            file?.path ?? "",
            Keymap.isModEvent(event),
          );
        }}
      />,
    );
  }
}
