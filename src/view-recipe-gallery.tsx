import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import { RecipeGallery, type SortMode } from "./components/RecipeGallery";
import { getRecipeFiles, loadRecipes } from "./utils/recipeLoader";
import { CompareRecipesModal } from "./modal-compare-recipes";
import * as c from "./constants";
import type RecipeVault from "./main";

// Remembered gallery UI state, shared across view instances for the plugin's
// lifetime. Obsidian builds a fresh RecipeGalleryView when you open a recipe and
// come back (or reopen the gallery), which would otherwise reset the search.
// Seeding new instances from this cache keeps the search, sort, and scroll.
const lastGalleryState: {
  scrollTop: number;
  searchQuery: string;
  sortMode: SortMode;
} = {
  scrollTop: 0,
  searchQuery: "",
  sortMode: "name",
};

/**
 * Clear the remembered gallery UI state so the next gallery instance opens
 * fresh. Called when the user explicitly opens the gallery (ribbon/command);
 * navigating into a recipe and back leaves the cache intact so the search
 * survives the round trip.
 */
export function resetGalleryUiState(): void {
  lastGalleryState.scrollTop = 0;
  lastGalleryState.searchQuery = "";
  lastGalleryState.sortMode = "name";
}

export class RecipeGalleryView extends ItemView {
  private plugin: RecipeVault;
  private root: ReturnType<typeof createRoot> | null = null;
  private savedScrollTop = lastGalleryState.scrollTop;
  private savedSearchQuery = lastGalleryState.searchQuery;
  private savedSortMode: SortMode = lastGalleryState.sortMode;
  private renderTimer: number | null = null;

  private isValidSortMode(value: unknown): value is SortMode {
    return (
      value === "name" ||
      value === "meal_type" ||
      value === "cook_time" ||
      value === "times_made"
    );
  }

  constructor(leaf: WorkspaceLeaf, plugin: RecipeVault) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return c.VIEW_TYPE_RECIPE_GALLERY;
  }

  getDisplayText(): string {
    return "Recipe gallery";
  }

  getIcon(): string {
    return "utensils";
  }

  async onOpen(): Promise<void> {
    this.render();

    // Keep the gallery current as notes are created, renamed, modified, or retagged.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.scheduleRender();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.scheduleRender();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) this.scheduleRender();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRender()),
    );
  }

  /**
   * Re-render once the vault goes quiet for a moment. A folder import creates
   * notes back to back, and each one fires a create and a metadata event.
   * Rendering on every event redraws the whole gallery twice per note, and
   * one redraw measured ~150ms with 18,000 notes.
   */
  private scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 250);
  }

  async onClose(): Promise<void> {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.root?.unmount();
    this.root = null;
  }

  /** Debounced, since a folder import of .cook files calls this per file. */
  refresh(): void {
    this.scheduleRender();
  }

  async setState(state: unknown): Promise<void> {
    const next = state as {
      scrollTop?: unknown;
      searchQuery?: unknown;
      sortMode?: unknown;
    } | null;
    const scrollTop = next?.scrollTop;
    // Fall back to the shared cache (not the defaults) so a fresh instance
    // restored without explicit history state keeps the last-used search/sort.
    this.savedScrollTop =
      typeof scrollTop === "number" && Number.isFinite(scrollTop)
        ? Math.max(0, scrollTop)
        : lastGalleryState.scrollTop;

    this.savedSearchQuery =
      typeof next?.searchQuery === "string"
        ? next.searchQuery
        : lastGalleryState.searchQuery;
    this.savedSortMode = this.isValidSortMode(next?.sortMode)
      ? next.sortMode
      : lastGalleryState.sortMode;

    lastGalleryState.scrollTop = this.savedScrollTop;
    lastGalleryState.searchQuery = this.savedSearchQuery;
    lastGalleryState.sortMode = this.savedSortMode;
    this.render();
  }

  getState(): Record<string, unknown> {
    return {
      scrollTop: this.savedScrollTop,
      searchQuery: this.savedSearchQuery,
      sortMode: this.savedSortMode,
    };
  }

  private render(): void {
    const galleryFolder = this.plugin.getGalleryFolder();
    const recipes = loadRecipes(
      this.app.vault,
      this.app.metadataCache,
      galleryFolder,
      (path) => this.plugin.getIngredients(path),
      (path) => this.plugin.getCooklangInfo(path),
    );

    // When the gallery is empty, check whether recipes are actually landing in
    // the configured save folder (imports go there, but the gallery only scans
    // the gallery folder). If so, point the user at the mismatch.
    let recipesElsewhereFolder: string | undefined;
    if (recipes.length === 0) {
      const saveFolder = this.plugin.settings.folder.trim();
      const normalize = (p: string) =>
        p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      if (
        saveFolder &&
        normalize(saveFolder) !== normalize(galleryFolder) &&
        getRecipeFiles(this.app.vault, saveFolder).length > 0
      ) {
        recipesElsewhereFolder = saveFolder;
      }
    }

    const container = this.contentEl;
    container.addClass("recipe-gallery-view-container");

    if (!this.root) {
      this.root = createRoot(container);
    }

    this.root.render(
      <RecipeGallery
        recipes={recipes}
        galleryFolder={galleryFolder}
        recipesElsewhereFolder={recipesElsewhereFolder}
        initialScrollTop={this.savedScrollTop}
        initialSearchQuery={this.savedSearchQuery}
        initialSortMode={this.savedSortMode}
        onScrollTopChange={(scrollTop) => {
          this.savedScrollTop = scrollTop;
          lastGalleryState.scrollTop = scrollTop;
        }}
        onSearchQueryChange={(searchQuery) => {
          this.savedSearchQuery = searchQuery;
          lastGalleryState.searchQuery = searchQuery;
        }}
        onSortModeChange={(sortMode) => {
          this.savedSortMode = sortMode;
          lastGalleryState.sortMode = sortMode;
        }}
        onOpen={(path: string) => {
          void (async () => {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (abstractFile instanceof TFile) {
              // Open in this leaf, in reading mode, when entering from gallery.
              await this.plugin.openRecipe(this.leaf, abstractFile);
            }
          })();
        }}
        onCompare={(selected) => {
          new CompareRecipesModal(this.app, this.plugin, selected).open();
        }}
        onOpenInSplit={(paths) => {
          void (async () => {
            for (const path of paths) {
              const file = this.app.vault.getAbstractFileByPath(path);
              if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf("split");
                await this.plugin.openRecipe(leaf, file);
              }
            }
          })();
        }}
      />,
    );
  }
}
