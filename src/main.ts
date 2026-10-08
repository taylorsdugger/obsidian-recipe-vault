import {
  MarkdownRenderer,
  MarkdownView,
  MarkdownPostProcessorContext,
  MarkdownSectionInformation,
  Platform,
  Plugin,
  debounce,
  Notice,
  requestUrl,
  normalizePath,
  TAbstractFile,
  TFolder,
  TFile,
  Vault,
  WorkspaceLeaf,
} from "obsidian";

import * as c from "./constants";
import * as settings from "./settings";
import { LoadRecipeModal } from "./modal-load-recipe";
import { NewRecipeModal } from "./modal-new-recipe";
import {
  RefineRecipeModal,
  RecipeRefineApplyResult,
} from "./modal-refine-recipe";
import { RecipeGalleryView, resetGalleryUiState } from "./view-recipe-gallery";
import { CooklangView } from "./view-cooklang";
import {
  type CooklangIndexInfo,
  getRecipeFiles,
  thumbPathForImage,
} from "./utils/recipeLoader";
import { PhotoRecipeModal } from "./modal-photo-recipe";
import { CookModeModal } from "./modal-cook";
import {
  RecipeNoteLayout,
  buildRecipeActions,
  buildScaleControl,
  gridMetaCallout,
  isIngredientList,
  scaleRenderedIngredients,
  syncScaleControl,
  wrapTaskText,
} from "./recipe-note-layout";
import type { RecipeActions, RecipeLayoutKind } from "./recipe-note-layout";
import {
  RecipeOutline,
  cookSteps,
  countChecked,
  holdsActions,
  ingredientLines,
  recipeOutline,
  sectionRole,
  takeCheckedIngredients,
} from "./recipe-structure";
import { ConfirmModal } from "./modal-confirm";
import { buildNutritionStrip } from "./recipe-nutrition";
import {
  PickRecipeFileModal,
  isCooklangFile,
  isImportableRecipeFile,
} from "./modal-pick-recipe-file";
import {
  requestRecipeEditSuggestion,
  requestRecipeChatResponse,
  requestRecipeFromImage,
} from "./utils/openrouter";
import dateFormat from "dateformat";
import * as core from "@recipe-vault/core";
import {
  addRecipeNutrition,
  compareByAisle,
  createRecipeRenderer,
  decodeHtmlEntities,
  addNoteNutrition,
  ensureRecipeNotesSection,
  ensureRequiredRecipeFrontmatter,
  ingredientsFromBody,
  itemsFromIngredientLine,
  nutritionFromFields,
  pageNutrition,
  recipeNutritionInfo,
  readRecipeFile,
  recipeToCooklang,
  setCooklangMetadata,
  setRecipeHistory,
  mergeShoppingItems,
  migrateImageLink,
  normalizePhotoProperty,
  normalizeRecipeNotes,
  noteToCooklang,
  noteToJsonLd,
  parseRecipeSections,
  readRecipeVaultState,
  replaceRecipeSections,
  parseShoppingListMarkdown,
  removeCheckedItems,
  ingredientsForSteps,
  editPromptFromChat,
  renderShoppingListMarkdown,
  scaleIngredientLine,
  scaleLabel,
} from "@recipe-vault/core";
import type {
  JsonRecord,
  Nutrition,
  ParsedRecipe,
  ShoppingItem,
} from "@recipe-vault/core";

/** A recipe the nutrition backfill will fetch for. */
interface NutritionTarget {
  file: TFile;
  url: string;
  title: string;
}

/** One recipe's entry in the persisted ingredient search index. */
interface IngredientIndexEntry {
  /** The file's modified time when it was indexed, so we can skip re-reads. */
  mtime: number;
  /**
   * Ingredient lines, from a note's `### Ingredients` section or the
   * ingredients a `.cook` file's steps mark up.
   */
  ingredients: string[];
  /** For a `.cook` file, what the gallery would otherwise get from frontmatter. */
  cook?: CooklangIndexInfo;
}

/** Vault augmented with the (untyped) attachment-path helper Obsidian exposes. */
type VaultWithAttachments = Vault & {
  getAvailablePathForAttachments(
    fileName: string,
    extension: string,
    file: TFile | null,
  ): Promise<string>;
};

/**
 * What a note imported from `file` records as its `source_file`. A JSON file
 * can hold several recipes, and each needs its own key or every one after the
 * first would look already imported.
 */
function sourceFileKey(file: TFile, index: number, count: number): string {
  return count > 1 ? `${file.path}#${index + 1}` : file.path;
}

export default class RecipeVault extends Plugin {
  settings!: settings.PluginSettings;

  /** Base backoff between fetch retries (ms); scaled per attempt. Tests set 0. */
  fetchRetryDelayMs = 500;

  /**
   * In-memory ingredient search index, keyed by note path. Built from each
   * recipe's body `### Ingredients` section — the body stays the single source
   * of truth and nothing is written to user notes. The gallery search reads
   * from this map (see {@link getIngredients} / loadRecipes). Persisted to a
   * sidecar JSON file so launches only re-read bodies whose mtime changed.
   */
  private ingredientIndex = new Map<string, IngredientIndexEntry>();

  /** Pending-write flag and debounce handle for {@link persistIngredientIndex}. */
  private ingredientIndexDirty = false;
  private persistIndexTimer: number | null = null;

  /** Set while a folder import runs, so a second one can't start on top. */
  private folderImportRunning = false;

  private hasRecipeNoteCssClass(value: unknown): boolean {
    return Array.isArray(value)
      ? value.includes("recipe-note")
      : typeof value === "string"
        ? value
            .split(/[\s,]+/)
            .filter(Boolean)
            .includes("recipe-note")
        : false;
  }

  async ensureRecipeNoteCssClass(file: TFile): Promise<boolean> {
    // Front matter edits through Obsidian only work on notes.
    if (file.extension !== "md") return false;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (this.hasRecipeNoteCssClass(fm?.cssclasses)) {
      return false;
    }

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter: JsonRecord) => {
        const existing = frontmatter.cssclasses;
        if (Array.isArray(existing)) {
          const arr = existing as unknown[];
          frontmatter.cssclasses = arr.includes("recipe-note")
            ? arr
            : [...arr, "recipe-note"];
        } else if (typeof existing === "string" && existing.trim()) {
          const parts = existing.split(/[\s,]+/).filter(Boolean);
          if (!parts.includes("recipe-note")) {
            parts.push("recipe-note");
          }
          frontmatter.cssclasses = parts.join(" ");
        } else {
          frontmatter.cssclasses = "recipe-note";
        }
      },
    );

    return true;
  }

  /**
   * Merge ingredient lines into the shopping list file, in aisle order, and
   * say how many were new.
   */
  async addToShoppingList(
    checked: string[],
    recipeName: string,
  ): Promise<void> {
    // Parse new items. One line can make two ("salt and pepper") or none
    // (water), so this flattens.
    const newItems: ShoppingItem[] = checked.flatMap((text) =>
      itemsFromIngredientLine(text, recipeName),
    );

    // Read and parse existing shopping list
    const listPath = normalizePath(this.settings.shoppingListFile);
    const existingFile = this.app.vault.getAbstractFileByPath(listPath);
    let headerLines: string[] = [];
    let existingItems: ShoppingItem[] = [];

    if (existingFile && existingFile instanceof TFile) {
      const existingContent = await this.app.vault.read(existingFile);
      ({ headerLines, items: existingItems } =
        parseShoppingListMarkdown(existingContent));
    }

    // Merge new items into existing list
    const { items, mergedCount } = mergeShoppingItems(existingItems, newItems);

    // Rebuild and write the file, in aisle order. This command already
    // re-renders the whole note, so sorting it costs nothing extra and
    // saves walking the shop twice.
    const newContent = renderShoppingListMarkdown(
      headerLines,
      [...items].sort(compareByAisle),
    );

    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.process(existingFile, () => newContent);
    } else {
      const folder = listPath.includes("/")
        ? listPath.substring(0, listPath.lastIndexOf("/"))
        : "";
      if (folder) await this.folderCheck(folder);
      await this.app.vault.create(listPath, newContent);
    }

    const added = newItems.length - mergedCount;
    const msg = [
      mergedCount ? `${mergedCount} merged` : "",
      added ? `${added} new` : "",
    ]
      .filter(Boolean)
      .join(", ");
    new Notice(
      `Shopping list updated (${msg || newItems.length + " items"}) → ${this.settings.shoppingListFile}`,
    );
  }

  /**
   * Count one more time made and stamp today, in the recipe's own front
   * matter: `times_made` in a note, `times made` in a `.cook` file.
   */
  async markRecipeMade(file: TFile): Promise<void> {
    const today = dateFormat(new Date(), "yyyy-mm-dd");
    if (isCooklangFile(file)) {
      await this.app.vault.process(file, (text) => {
        const current = readRecipeFile(file.path, text)?.timesMade ?? 0;
        return setRecipeHistory(file.path, text, {
          timesMade: current + 1,
          lastMade: today,
        });
      });
    } else {
      await this.app.fileManager.processFrontMatter(file, (fm: JsonRecord) => {
        const current = typeof fm.times_made === "number" ? fm.times_made : 0;
        fm.times_made = current + 1;
        fm.last_made = today;
      });
    }
    new Notice("Marked as made!");
  }

  /**
   * Open a recipe in `leaf` in reading mode: a note in the markdown view with
   * the recipe styling, a `.cook` file in the Cooklang view.
   */
  async openRecipe(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    if (isCooklangFile(file)) {
      await leaf.setViewState({
        type: c.VIEW_TYPE_COOKLANG,
        state: { file: file.path, mode: "preview" },
        active: true,
      });
      return;
    }
    await this.ensureRecipeNoteCssClass(file);
    await leaf.setViewState({
      type: "markdown",
      state: { file: file.path, mode: "preview" },
      active: true,
    });
  }

  private isRecipeFile(file: TFile): boolean {
    // The template file has the recipe tag and css class, but it isn't one.
    if (this.isTemplateFile(file)) return false;
    // A .cook file is a recipe by what it is. There's no tag to look for.
    if (isCooklangFile(file)) return true;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return false;

    const tags: unknown = fm.tags;
    const hasRecipeTag = Array.isArray(tags)
      ? tags.some(
          (tag: string) =>
            String(tag).toLowerCase().replace(/^#/, "").trim() === "recipe",
        )
      : typeof tags === "string"
        ? tags
            .split(/[\s,]+/)
            .map((tag) => tag.toLowerCase().replace(/^#/, "").trim())
            .includes("recipe")
        : false;

    if (hasRecipeTag) return true;

    // Fallback: many existing notes rely on the recipe-note css class instead of tags.
    return this.hasRecipeNoteCssClass(
      (fm as Record<string, unknown>).cssclasses,
    );
  }

  private isShoppingListFile(file: TFile): boolean {
    return (
      normalizePath(file.path) === normalizePath(this.settings.shoppingListFile)
    );
  }

  /** The template file setting as a vault path, or "" when it's blank. */
  templateFilePath(): string {
    const raw = this.settings.recipeTemplateFile.trim();
    if (!raw) return "";
    const path = normalizePath(raw);
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
  }

  private isTemplateFile(file: TFile): boolean {
    const path = this.templateFilePath();
    return path !== "" && normalizePath(file.path) === path;
  }

  /** The front matter key a note keeps its photo under. */
  photoProperty(): string {
    return normalizePhotoProperty(this.settings.photoProperty);
  }

  /**
   * The template new notes are rendered from: the template file when one is
   * set, else the one in settings. A template file that's gone falls back to
   * the settings one with a notice, so an import never fails over it.
   */
  private async getRecipeTemplate(): Promise<string> {
    const path = this.templateFilePath();
    if (!path) return this.settings.recipeTemplate;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      // Same patch the settings template gets on load, applied in memory so
      // the user's file is never rewritten.
      return migrateImageLink(await this.app.vault.cachedRead(file));
    }

    // Once per path, so a folder import doesn't stack one per recipe.
    if (this.missingTemplateWarned !== path) {
      this.missingTemplateWarned = path;
      new Notice(
        `Recipe Vault: couldn't find the template file "${path}". Using the template in settings instead.`,
        8000,
      );
    }
    return this.settings.recipeTemplate;
  }

  private missingTemplateWarned = "";

  /**
   * Write the settings template out to a new note and point the template file
   * setting at it. Returns the new path, or null when it couldn't be written.
   */
  async createTemplateFile(): Promise<string | null> {
    const base = c.TEMPLATE_FILE_DEFAULT_PATH.replace(/\.md$/, "");
    let path = normalizePath(c.TEMPLATE_FILE_DEFAULT_PATH);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${base} (${n}).md`);
    }

    try {
      await this.app.vault.create(path, this.settings.recipeTemplate);
    } catch (err) {
      console.error("Recipe Vault: failed to create template file", err);
      new Notice("Recipe Vault: couldn't create the template file.");
      return null;
    }

    this.settings.recipeTemplateFile = path;
    await this.saveSettings();
    new Notice(`Created ${path}. New recipes use it now.`);
    return path;
  }

  /** The parsed outline of a note's text, kept for the last few texts seen. */
  private outlineCache = new Map<string, RecipeOutline>();

  private outlineOf(text: string): RecipeOutline {
    let outline = this.outlineCache.get(text);
    if (!outline) {
      outline = recipeOutline(text);
      // Reading view hands over the same text once per section, so a tiny
      // cache saves re-parsing the note for every one of them.
      if (this.outlineCache.size > 8) this.outlineCache.clear();
      this.outlineCache.set(text, outline);
    }
    return outline;
  }

  /**
   * Tag each reading-view section with its part of the recipe, so the css
   * can lay the note out by role instead of guessing from headings. Done
   * per section at render time, which survives reading view dropping
   * sections from the dom as you scroll.
   */
  private processRecipeSection(
    el: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile) || !this.isRecipeFile(file)) return;
    const info = context.getSectionInfo(el);
    if (info) {
      this.lastNoteText.set(file.path, info.text);
      this.tagRecipeSection(el, file, info);
      return;
    }

    // Null for anything that isn't one section of a whole note, which then
    // just lays out in the single column. But reading view also hands over a
    // section it's re-rendering after an edit (a tick, say) before it can say
    // which lines it covers. An ingredient list missed that way would show up
    // in the main column next to the rail, so it's recognised by its lines,
    // and anything else gets another try once reading view has caught up.
    const known = this.lastNoteText.get(file.path);
    if (known && isIngredientList(el, known)) {
      el.dataset.recipeSection = "ingredients";
      this.prepareIngredientSection(el, file);
      return;
    }
    const retry = (tries: number) => {
      const later = context.getSectionInfo(el);
      if (later) this.tagRecipeSection(el, file, later);
      else if (tries > 0) window.setTimeout(() => retry(tries - 1), 50);
    };
    window.requestAnimationFrame(() => retry(3));
  }

  /** The last full text reading view showed for each recipe note. */
  private lastNoteText = new Map<string, string>();

  private tagRecipeSection(
    el: HTMLElement,
    file: TFile,
    info: MarkdownSectionInformation,
  ): void {
    const outline = this.outlineOf(info.text);
    const role = sectionRole(outline, info.lineStart, info.lineEnd);
    if (role) el.dataset.recipeSection = role;
    if (role === "meta") gridMetaCallout(el);
    if (role === "ingredients") {
      // Every section under the heading is "ingredients": the heading
      // itself, the list, and each group's list in a recipe that splits
      // them up. Only the heading's gets the scale control, so there's one.
      const start = outline.ingredients?.start ?? -1;
      this.prepareIngredientSection(
        el,
        file,
        info.lineStart <= start && start <= info.lineEnd,
      );
    }

    if (
      holdsActions(outline, info.lineStart, info.lineEnd) &&
      !el.querySelector(".recipe-note-actions")
    ) {
      // Always there, empty or not, so nutrition added to the frontmatter
      // later has somewhere to show up without re-rendering the note.
      const slot = el.createDiv({ cls: "recipe-nutrition-slot" });
      this.fillNoteNutrition(slot, file);
      const checked = outline.ingredients
        ? countChecked(info.text, outline.ingredients)
        : 0;
      el.append(buildRecipeActions(file, this.recipeActions, checked));
    }
  }

  /**
   * A recipe's nutrition strip, into `slot`, or nothing when it has none.
   * Left alone when the numbers haven't changed, so a popover that's open
   * stays open through an unrelated edit.
   */
  fillNutritionSlot(
    slot: HTMLElement,
    file: TFile,
    nutrition: Nutrition | null,
    servings: string,
    servingSize: string,
    sourceUrl: string,
  ): void {
    const shown = this.settings.showNutrition ? nutrition : null;
    const key = JSON.stringify([shown, servings, servingSize, sourceUrl]);
    if (slot.dataset.nutrition === key) return;
    slot.dataset.nutrition = key;
    slot.empty();
    if (!shown) return;
    slot.append(
      buildNutritionStrip({
        app: this.app,
        nutrition: shown,
        servings,
        servingSize,
        sourceUrl,
        scale: () => this.recipeScale(file),
      }),
    );
  }

  /** A note's strip, from its `calories`, `protein` and the rest. */
  private fillNoteNutrition(slot: HTMLElement, file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const url: unknown = fm?.url;
    const size: unknown = fm?.serving_size;
    this.fillNutritionSlot(
      slot,
      file,
      nutritionFromFields(fm),
      this.noteServings(file),
      typeof size === "string" ? size.trim() : "",
      typeof url === "string" ? url.trim() : "",
    );
  }

  /** Show or hide the nutrition line on every open recipe. */
  applyNutritionSetting(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) {
        this.refreshNoteNutrition(view.file);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(
      c.VIEW_TYPE_COOKLANG,
    )) {
      if (leaf.view instanceof CooklangView) leaf.view.refreshLayout();
    }
  }

  /** After a frontmatter edit, bring every open view of the note along. */
  private refreshNoteNutrition(file: TFile): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file !== file) continue;
      view.previewMode.containerEl
        .querySelectorAll<HTMLElement>(".recipe-nutrition-slot")
        .forEach((slot) => this.fillNoteNutrition(slot, file));
    }
  }

  /**
   * An ingredient section as reading view drew it, made into the recipe's:
   * each row's text in its own span and the amounts at the recipe's current
   * scale. With `withControl`, the scale control goes in under the heading.
   */
  prepareIngredientSection(
    el: HTMLElement,
    file: TFile,
    withControl = false,
  ): void {
    wrapTaskText(el);
    if (withControl && !el.querySelector(".recipe-scale")) {
      const control = this.recipeScaleControl(file);
      const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading) heading.after(control);
      else el.prepend(control);
    }
    scaleRenderedIngredients(el, this.recipeScale(file));
  }

  /**
   * How much of each recipe to make, by path: 2 for a double batch. Kept for
   * the session rather than in the file, since it's about tonight, not the
   * recipe. Anything left out is 1x.
   */
  private recipeScales = new Map<string, number>();

  recipeScale(file: TFile): number {
    return this.recipeScales.get(file.path) ?? 1;
  }

  /** A note's `servings` (or `yield`, `serves`), as written. */
  private noteServings(file: TFile): string {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value: unknown = fm?.servings ?? fm?.yield ?? fm?.serves;
    if (typeof value === "number") return String(value);
    return typeof value === "string" ? value.trim() : "";
  }

  /** The scale control for a note, set to its current scale. */
  recipeScaleControl(file: TFile): HTMLElement {
    return buildScaleControl(
      this.noteServings(file),
      this.recipeScale(file),
      (factor) => this.setRecipeScale(file, factor),
    );
  }

  /**
   * Scale a recipe, and bring every open view of it along: the amounts in a
   * note's reading view and its rail, every scale control, and a `.cook` view.
   */
  setRecipeScale(file: TFile, factor: number): void {
    if (factor === 1) this.recipeScales.delete(file.path);
    else this.recipeScales.set(file.path, factor);

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file !== file) continue;
      const root = view.previewMode.containerEl;
      root
        .querySelectorAll<HTMLElement>(
          '[data-recipe-section="ingredients"], .recipe-rail',
        )
        .forEach((el) => scaleRenderedIngredients(el, factor));
      root
        .querySelectorAll<HTMLElement>(".recipe-scale")
        .forEach((el) => syncScaleControl(el, factor));
    }
    for (const leaf of this.app.workspace.getLeavesOfType(
      c.VIEW_TYPE_COOKLANG,
    )) {
      if (leaf.view instanceof CooklangView && leaf.view.file === file) {
        leaf.view.refreshLayout();
      }
    }
  }

  /** What the recipe buttons do, wherever they're drawn. */
  readonly recipeActions: RecipeActions = {
    markMade: (file) => void this.markRecipeMade(file),
    addToList: (file) => void this.addCheckedIngredientsFromNote(file),
    askAi: (file) => void this.askAiToRefineRecipe(file, ""),
    cook: (file) => void this.openCookMode(file),
    aiEnabled: () => this.settings.aiFeatures,
  };

  /**
   * Rebuild the buttons on open recipes after a setting that changes them,
   * like turning AI features off. A note's action row is drawn as reading
   * view renders, and the phone dock with its layout, so both are redone.
   * A `.cook` view draws its own.
   */
  refreshRecipeActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const layout = this.recipeLayouts.get(view);
      if (layout) {
        view.removeChild(layout);
        this.recipeLayouts.delete(view);
      }
      view.previewMode.rerender(true);
    }
    this.applyRecipeLayoutSetting();
  }

  /**
   * Which reading-view layout a recipe gets. Kitchen, when it's turned on,
   * goes to a phone or tablet, and to a desktop pane about as narrow as one.
   * `width` is the pane's, or 0 when it can't be measured (a background tab),
   * which never counts as narrow.
   */
  recipeLayoutKind(width: number): RecipeLayoutKind {
    if (this.settings.mobileRecipeLayout !== "kitchen") return "rail";
    if (Platform.isMobile) return "kitchen";
    return width > 0 && width < c.KITCHEN_MAX_WIDTH ? "kitchen" : "rail";
  }

  private recipeLayouts = new WeakMap<MarkdownView, RecipeNoteLayout>();

  /**
   * Give every open recipe note in reading view its layout, and take it off
   * any view that's moved to another file, gone to editing, or needs the
   * other layout after a settings change.
   */
  refreshRecipeLayouts(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      this.syncRecipeLayout(leaf.view);
      this.collapseRecipeProperties(leaf.view);
    }
  }

  /**
   * The file each view is showing, and whether its properties have been
   * folded since it opened there.
   */
  private propertiesFolded = new WeakMap<
    MarkdownView,
    { path: string; done: boolean }
  >();

  /**
   * Fold a recipe's properties when it opens, once per opening, so the
   * recipe is what you see first. Done the way clicking Properties does it,
   * and saved with the note's folds the same way, so going between reading
   * and editing keeps it folded. Open it and it stays open until the next
   * time the recipe is opened.
   *
   * The properties panel isn't in Obsidian's public api, so every piece of it
   * is checked first. If a later version changes it, this does nothing.
   */
  private collapseRecipeProperties(view: MarkdownView): void {
    const file = view.file;
    if (!file || !this.settings.collapseRecipeProperties) return;
    // Every note a view shows is noted, not just recipes, so going to
    // another note and back counts as opening the recipe again.
    let seen = this.propertiesFolded.get(view);
    if (seen?.path !== file.path) {
      seen = { path: file.path, done: false };
      this.propertiesFolded.set(view, seen);
    }
    if (seen.done) return;
    // Not a recipe yet can still become one while it's open: an import
    // opens an empty note and writes the recipe into it after.
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (
      this.isTemplateFile(file) ||
      !this.hasRecipeNoteCssClass(fm?.cssclasses)
    )
      return;
    seen.done = true;

    const inner = view as unknown as {
      metadataEditor?: {
        collapsed?: unknown;
        setCollapse?: (collapsed: boolean, animate?: boolean) => void;
      };
      onMarkdownFold?: () => void;
    };
    const panel = inner.metadataEditor;
    if (!panel || panel.collapsed === true) return;
    if (typeof panel.setCollapse !== "function") return;
    // No animation: it should already be folded when the note appears.
    // That also skips the save, so it's done after.
    panel.setCollapse(true, false);
    if (typeof inner.onMarkdownFold === "function") inner.onMarkdownFold();
  }

  /** After the layout setting changes. A `.cook` view draws its own. */
  applyRecipeLayoutSetting(): void {
    this.refreshRecipeLayouts();
    for (const leaf of this.app.workspace.getLeavesOfType(
      c.VIEW_TYPE_COOKLANG,
    )) {
      if (leaf.view instanceof CooklangView) leaf.view.refreshLayout();
    }
  }

  private syncRecipeLayout(view: MarkdownView): void {
    const file = view.file;
    const fm = file
      ? this.app.metadataCache.getFileCache(file)?.frontmatter
      : undefined;
    const current = this.recipeLayouts.get(view);
    // A hidden pane measures 0 wide. It keeps the layout it has rather than
    // flipping to the other one until it's shown again.
    const width = view.contentEl.clientWidth;
    const kind =
      width === 0 && current ? current.kind : this.recipeLayoutKind(width);
    // The template file carries the recipe css class, but it isn't a recipe.
    const wanted =
      file &&
      view.getMode() === "preview" &&
      !this.isTemplateFile(file) &&
      this.hasRecipeNoteCssClass(fm?.cssclasses)
        ? kind
        : null;
    if (current && (current.file !== file || current.kind !== wanted)) {
      view.removeChild(current);
      this.recipeLayouts.delete(view);
    }
    if (file && wanted && !this.recipeLayouts.has(view)) {
      const layout = new RecipeNoteLayout(
        this,
        view,
        file,
        wanted,
        this.recipeActions,
      );
      this.recipeLayouts.set(view, layout);
      view.addChild(layout);
    }
  }

  /**
   * Send a note's ticked ingredients to the shopping list and untick them.
   * Works from reading view too, since it goes through the file rather than
   * the editor.
   */
  async addCheckedIngredientsFromNote(file: TFile): Promise<void> {
    let checked: string[] = [];
    await this.app.vault.process(file, (content) => {
      const taken = takeCheckedIngredients(content);
      checked = taken.checked;
      return checked.length > 0 ? taken.text : content;
    });
    if (checked.length === 0) {
      new Notice("No checked ingredients found.");
      return;
    }
    // The amounts the note is showing, so a double batch buys double.
    const factor = this.recipeScale(file);
    await this.addToShoppingList(
      checked.map((line) => scaleIngredientLine(line, factor)),
      file.basename,
    );
  }

  /** The recipe's steps one at a time, from a note or a `.cook` file. */
  async openCookMode(file: TFile): Promise<void> {
    if (isCooklangFile(file)) {
      const view = this.app.workspace
        .getLeavesOfType(c.VIEW_TYPE_COOKLANG)
        .map((leaf) => leaf.view)
        .find(
          (v): v is CooklangView =>
            v instanceof CooklangView && v.file === file,
        );
      view?.openCookMode();
      return;
    }
    const text = await this.app.vault.read(file);
    const outline = recipeOutline(text);
    if (!outline.instructions) {
      new Notice("This recipe has no steps to cook from.");
      return;
    }
    const factor = this.recipeScale(file);
    const ingredients = (
      outline.ingredients ? ingredientLines(text, outline.ingredients) : []
    ).map((line) => scaleIngredientLine(line, factor));
    // Matched across the whole recipe at once: which of two butters a step
    // means depends on the steps before it.
    const found = cookSteps(text, outline.instructions);
    const uses = ingredientsForSteps(
      found.map((step) => step.text),
      ingredients,
    );
    const steps = found.map((step, i) => ({ ...step, uses: uses[i] }));
    if (steps.length === 0) {
      new Notice("No steps found in this recipe.");
      return;
    }
    new CookModeModal(this.app, {
      title:
        factor === 1
          ? file.basename
          : `${file.basename} · ${scaleLabel(factor)}`,
      steps,
      ingredients,
      renderText: (markdown, el, owner) =>
        void MarkdownRenderer.render(this.app, markdown, el, file.path, owner),
      onMarkMade: () => void this.markRecipeMade(file),
    }).open();
  }

  /** Ingredient lines for a note path, for the gallery search (loadRecipes). */
  getIngredients(path: string): string[] {
    return this.ingredientIndex.get(path)?.ingredients ?? [];
  }

  /** What the index read out of a `.cook` file, for the gallery card. */
  getCooklangInfo(path: string): CooklangIndexInfo | undefined {
    return this.ingredientIndex.get(path)?.cook;
  }

  /**
   * Read one recipe file into its index entry. A note gives its body's
   * `### Ingredients` section. A `.cook` file is parsed whole, since there's
   * no metadata cache to read its front matter from.
   */
  private async readIndexEntry(file: TFile): Promise<IngredientIndexEntry> {
    const content = await this.app.vault.cachedRead(file);
    if (!isCooklangFile(file)) {
      return {
        mtime: file.stat.mtime,
        ingredients: ingredientsFromBody(content),
      };
    }
    const summary = readRecipeFile(file.path, content);
    return {
      mtime: file.stat.mtime,
      ingredients: summary?.ingredients ?? [],
      cook: {
        title: summary?.title ?? file.basename,
        photo: summary?.photo ?? "",
        mealType: summary?.mealType ?? "",
        cookTime: summary?.cookTime ?? "",
        timesMade: summary?.timesMade ?? 0,
        sourceUrl: summary?.sourceUrl ?? "",
        sourceFile: summary?.sourceFile ?? "",
      },
    };
  }

  /** Path of the sidecar index file, or null if the plugin dir is unknown. */
  private get ingredientIndexPath(): string | null {
    return this.manifest.dir
      ? `${this.manifest.dir}/ingredient-index.json`
      : null;
  }

  /** Load the persisted ingredient index into memory (best effort). */
  private async loadIngredientIndex(): Promise<void> {
    this.ingredientIndex.clear();
    const path = this.ingredientIndexPath;
    if (!path) return;
    try {
      if (!(await this.app.vault.adapter.exists(path))) return;
      const parsed = JSON.parse(
        await this.app.vault.adapter.read(path),
      ) as Record<string, IngredientIndexEntry>;
      for (const [notePath, entry] of Object.entries(parsed)) {
        if (
          entry &&
          typeof entry.mtime === "number" &&
          Array.isArray(entry.ingredients)
        ) {
          this.ingredientIndex.set(notePath, {
            mtime: entry.mtime,
            ingredients: entry.ingredients.map((s) => String(s)),
            ...(entry.cook && typeof entry.cook === "object"
              ? { cook: entry.cook }
              : {}),
          });
        }
      }
    } catch (err) {
      console.error("Recipe Vault: failed to load ingredient index", err);
    }
  }

  /** Mark the index dirty and schedule a debounced write to the sidecar file. */
  private queuePersistIngredientIndex(): void {
    this.ingredientIndexDirty = true;
    if (this.persistIndexTimer !== null) return;
    this.persistIndexTimer = window.setTimeout(() => {
      this.persistIndexTimer = null;
      void this.persistIngredientIndex();
    }, 1000);
  }

  /** Write the in-memory index to the sidecar file if it has pending changes. */
  private async persistIngredientIndex(): Promise<void> {
    if (!this.ingredientIndexDirty) return;
    const path = this.ingredientIndexPath;
    if (!path) return;
    this.ingredientIndexDirty = false;
    const obj: Record<string, IngredientIndexEntry> = {};
    for (const [notePath, entry] of this.ingredientIndex) obj[notePath] = entry;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(obj));
    } catch (err) {
      console.error("Recipe Vault: failed to persist ingredient index", err);
      this.ingredientIndexDirty = true;
    }
  }

  /** (Re)index a single recipe file. Never writes to the file. */
  private async indexRecipeFile(file: TFile): Promise<void> {
    try {
      this.ingredientIndex.set(file.path, await this.readIndexEntry(file));
      this.queuePersistIngredientIndex();
      // A note's change reaches the gallery through the metadata cache. A
      // .cook file has none, so the gallery hears about it from here.
      if (isCooklangFile(file)) this.refreshRecipeGalleryView();
    } catch (err) {
      console.error("Recipe Vault: failed to index", file.path, err);
    }
  }

  /** Drop a note from the index (file deleted or renamed away). */
  private removeRecipeFromIndex(path: string): void {
    if (this.ingredientIndex.delete(path)) {
      this.queuePersistIngredientIndex();
    }
  }

  /**
   * The folder the gallery browses. A blank "Recipe gallery folder" setting
   * follows the "Recipe save folder" so imports appear in the gallery with no
   * extra configuration; setting an explicit value overrides that.
   */
  getGalleryFolder(): string {
    return (
      this.settings.recipeGalleryFolder.trim() || this.settings.folder.trim()
    );
  }

  /**
   * Reconcile the persisted index against the current gallery folder on launch:
   * re-read only notes whose mtime changed, drop notes that no longer exist,
   * and refresh the gallery once if anything changed.
   */
  private async refreshIngredientIndex(): Promise<void> {
    const galleryFolder = this.getGalleryFolder();
    if (!galleryFolder) return;
    const files = getRecipeFiles(
      this.app.vault,
      galleryFolder,
      this.templateFilePath(),
    );
    const seen = new Set<string>();
    let changed = false;

    for (const file of files) {
      seen.add(file.path);
      const existing = this.ingredientIndex.get(file.path);
      // An entry from before .cook files were indexed has no `cook` part.
      if (
        existing &&
        existing.mtime === file.stat.mtime &&
        (existing.cook || !isCooklangFile(file))
      ) {
        continue;
      }
      try {
        this.ingredientIndex.set(file.path, await this.readIndexEntry(file));
        changed = true;
      } catch (err) {
        console.error("Recipe Vault: failed to index", file.path, err);
      }
    }

    for (const path of [...this.ingredientIndex.keys()]) {
      if (!seen.has(path)) {
        this.ingredientIndex.delete(path);
        changed = true;
      }
    }

    if (changed) {
      this.queuePersistIngredientIndex();
      this.refreshRecipeGalleryView();
    }
  }

  private async askAiToRefineRecipe(
    file: TFile,
    prompt: string,
  ): Promise<void> {
    const apiKey = this.settings.openRouterApiKey?.trim();
    if (!apiKey) {
      new Notice("Set your OpenRouter API key in Recipe Vault settings first.");
      return;
    }

    const model = this.resolveAiModelId();
    const timeoutMs = Math.max(this.settings.aiTimeoutMs ?? 45000, 5000);

    // Read + parse the note fresh on every call so chat context and generated
    // edits stay in sync with any edits already applied this session.
    const readRecipe = async () => {
      const content = await this.app.vault.read(file);
      const parsed = parseRecipeSections(content);
      if (!parsed) {
        throw new Error(
          "Could not find Ingredients and Instructions sections in this note.",
        );
      }
      if (
        parsed.recipeIngredient.length === 0 ||
        parsed.recipeInstructions.length === 0
      ) {
        throw new Error("Recipe is missing ingredient or instruction content.");
      }
      return parsed;
    };

    new RefineRecipeModal(
      this.app,
      // onChat — plain conversational reply, recipe passed as context.
      async (messages) => {
        const parsed = await readRecipe();
        return requestRecipeChatResponse({
          apiKey,
          model,
          messages,
          recipeIngredient: parsed.recipeIngredient,
          recipeInstructions: parsed.recipeInstructions,
          timeoutMs,
          systemPrompt: this.settings.aiSystemPrompt,
        });
      },
      // onSuggestEdit — generate a reviewable diff from the conversation.
      async (messages) => {
        const parsed = await readRecipe();
        const loadingNotice = new Notice("Generating recipe edits...", 0);
        try {
          const suggestion = await requestRecipeEditSuggestion({
            apiKey,
            model,
            prompt: editPromptFromChat(messages),
            recipeIngredient: parsed.recipeIngredient,
            recipeInstructions: parsed.recipeInstructions,
            timeoutMs,
            systemPrompt: this.settings.aiSystemPrompt,
          });
          return {
            summary: suggestion.summary,
            originalIngredients: parsed.recipeIngredient,
            originalInstructions: parsed.recipeInstructions,
            suggestedIngredients: suggestion.recipeIngredient,
            suggestedInstructions: suggestion.recipeInstructions,
          };
        } finally {
          loadingNotice.hide();
        }
      },
      // onApply — write the accepted edit back to the note.
      async (result: RecipeRefineApplyResult) => {
        if (result.recipeIngredient.length === 0) {
          new Notice("Ingredients cannot be empty.");
          return;
        }
        if (result.recipeInstructions.length === 0) {
          new Notice("Instructions cannot be empty.");
          return;
        }

        const latestContent = await this.app.vault.read(file);
        const updated = replaceRecipeSections(
          latestContent,
          result.recipeIngredient,
          result.recipeInstructions,
        );

        await this.app.vault.process(file, () => updated);
        new Notice("Applied AI recipe edits.");
      },
      prompt,
    ).open();
  }

  private resolveAiModelId(): string {
    const preset = this.settings.aiModelPreset?.trim();

    if (preset && preset !== "__other__") {
      return preset;
    }

    const custom = this.settings.aiCustomModelId?.trim();
    if (custom) {
      return custom;
    }

    const legacy = this.settings.aiModelId?.trim();
    return legacy || settings.DEFAULT_AI_MODEL;
  }

  onload() {
    // Obsidian types `onload` as returning void, and the setup here is async,
    // so the body lives in `init` and this just kicks it off.
    void this.init();
  }

  private async init() {
    await this.loadSettings();
    await this.loadIngredientIndex();
    // Reconcile the index against the vault once files are ready — re-reads only
    // notes whose mtime changed since last launch, then refreshes the gallery.
    this.app.workspace.onLayoutReady(() => {
      void this.refreshIngredientIndex();
    });

    this.registerMarkdownPostProcessor((el, context) => {
      this.processRecipeSection(el, context);
    });

    // Mode switches and file changes all come through one of these. A
    // front matter change can turn a note into a recipe, or stop it being one.
    const refreshLayouts = debounce(() => this.refreshRecipeLayouts(), 10);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", refreshLayouts),
    );
    this.registerEvent(this.app.workspace.on("file-open", refreshLayouts));
    this.registerEvent(this.app.workspace.on("layout-change", refreshLayouts));
    // Dragging a pane divider or the window edge can cross the Kitchen width.
    this.registerEvent(this.app.workspace.on("resize", refreshLayouts));
    this.registerEvent(this.app.metadataCache.on("changed", refreshLayouts));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) =>
        this.refreshNoteNutrition(file),
      ),
    );
    this.app.workspace.onLayoutReady(refreshLayouts);

    // Register the Recipe Gallery view
    this.registerView(
      c.VIEW_TYPE_RECIPE_GALLERY,
      (leaf) => new RecipeGalleryView(leaf, this),
    );

    // Open .cook files in a recipe view instead of hiding them. Another plugin
    // (like the Cooklang one) may have claimed the extension first, and
    // Obsidian throws on a second claim, so leave it to that plugin.
    this.registerView(
      c.VIEW_TYPE_COOKLANG,
      (leaf) => new CooklangView(leaf, this),
    );
    try {
      this.registerExtensions(["cook"], c.VIEW_TYPE_COOKLANG);
    } catch (error) {
      console.warn(
        "Recipe Vault: .cook files are already handled by another plugin",
        error,
      );
    }

    // Ribbon icon to open/reveal the gallery
    this.addRibbonIcon("utensils", "Open recipe gallery", () => {
      void this.activateRecipeGalleryView();
    });

    // Command: open/reveal gallery
    this.addCommand({
      id: c.CMD_OPEN_RECIPE_GALLERY,
      name: "Open recipe gallery",
      callback: () => this.activateRecipeGalleryView(),
    });

    // This creates an icon in the left ribbon.
    this.addRibbonIcon("chef-hat", "Import recipe", (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const selection = view?.editor.getSelection()?.trim();
      // try and make sure its a url
      if (selection?.startsWith("http") && selection.split(" ").length === 1) {
        void this.addRecipeToMarkdown(selection);
      } else {
        new LoadRecipeModal(this.app, (recipeUrl) => {
          void this.addRecipeToMarkdown(recipeUrl);
        }).open();
      }
    });

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: c.CMD_OPEN_MODAL,
      name: "Import recipe",
      callback: () => {
        new LoadRecipeModal(this.app, (recipeUrl) => {
          void this.addRecipeToMarkdown(recipeUrl);
        }).open();
      },
    });

    // Import a recipe by photographing a cookbook page / recipe card. Uses the
    // same OpenRouter path as Ask AI: the vision model does OCR + structured
    // extraction in one call, then the user verifies before saving.
    this.addCommand({
      id: c.CMD_RECIPE_FROM_PHOTO,
      name: "Add recipe from photo",
      checkCallback: (checking) => {
        if (!this.settings.aiFeatures) return false;
        if (checking) return true;
        const apiKey = this.settings.openRouterApiKey?.trim();
        if (!apiKey) {
          new Notice(
            "Set your OpenRouter API key in Recipe Vault settings first.",
          );
          return;
        }
        const model = this.resolveAiModelId();
        const timeoutMs = Math.max(this.settings.aiTimeoutMs ?? 45000, 5000);
        new PhotoRecipeModal(
          this.app,
          (images) =>
            requestRecipeFromImage({
              apiKey,
              model,
              images,
              timeoutMs,
              systemPrompt: this.settings.aiSystemPrompt,
            }),
          (submission) => {
            const { result, imageBlob } = submission;
            const recipe: ParsedRecipe = {
              name: result.name,
              author: result.author || undefined,
              description: result.description || undefined,
              totalTime: result.totalTime || undefined,
              recipeIngredient: result.recipeIngredient,
              // The template renders string steps via its `this.text` branch, so
              // wrap each transcribed line as an InstructionStep.
              recipeInstructions: result.recipeInstructions.map((text) => ({
                text,
              })),
            };
            if (result.recipeYield) recipe.recipeYield = result.recipeYield;
            void this.saveParsedRecipe(recipe, {
              localImage: imageBlob,
              source: "photo",
            });
          },
        ).open();
      },
    });

    // Command to increment times_made on the active recipe file
    this.addCommand({
      id: c.CMD_MARK_MADE,
      name: "Mark recipe as made",
      callback: async () => {
        const file =
          this.app.workspace.getActiveViewOfType(MarkdownView)?.file ??
          this.app.workspace.getActiveViewOfType(CooklangView)?.file;
        if (!file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.markRecipeMade(file);
      },
    });

    this.addCommand({
      id: c.CMD_COOK_MODE,
      name: "Start cook mode",
      checkCallback: (checking) => {
        const file =
          this.app.workspace.getActiveViewOfType(MarkdownView)?.file ??
          this.app.workspace.getActiveViewOfType(CooklangView)?.file;
        if (!file || !this.isRecipeFile(file)) return false;
        if (!checking) void this.openCookMode(file);
        return true;
      },
    });

    // Command to add checked ingredients to a shopping list file
    this.addCommand({
      id: c.CMD_ADD_TO_SHOPPING_LIST,
      name: "Add checked ingredients to shopping list",
      callback: async () => {
        // A .cook file's ticks live in its view, since the file has nowhere
        // to keep them.
        const cookView = this.app.workspace.getActiveViewOfType(CooklangView);
        if (cookView?.file) {
          const lines = cookView.checkedIngredients();
          if (lines.length === 0) {
            new Notice("No checked ingredients found.");
            return;
          }
          await this.addToShoppingList(lines, cookView.file.basename);
          cookView.clearChecked();
          return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.addCheckedIngredientsFromNote(view.file);
      },
    });

    // Command to batch import recipes from a list of URLs in the active file
    this.addCommand({
      id: c.CMD_BATCH_IMPORT,
      name: "Batch import recipes from URL list",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("Open a note containing a list of recipe URLs first.");
          return;
        }

        // Use selection if present, otherwise whole file
        const raw =
          view.editor.getSelection()?.trim() || view.editor.getValue();

        // Extract all lines that look like URLs
        const urls = raw
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^https?:\/\//i.test(l));

        if (urls.length === 0) {
          new Notice(
            "No URLs found. Put one URL per line in the note (or select them).",
          );
          return;
        }

        new Notice(
          `Starting batch import of ${urls.length} recipe${urls.length > 1 ? "s" : ""}…`,
        );

        // Force each recipe into its own file for batch imports
        const originalSaveInActiveFile = this.settings.saveInActiveFile;
        this.settings.saveInActiveFile = false;

        let success = 0;
        let failed = 0;
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          new Notice(`Importing ${i + 1} of ${urls.length}: ${url}`);
          try {
            await this.addRecipeToMarkdown(url);
            success++;
          } catch {
            failed++;
          }
          // Small delay to avoid hammering servers back-to-back
          if (i < urls.length - 1) {
            await new Promise((r) => window.setTimeout(r, 800));
          }
        }

        this.settings.saveInActiveFile = originalSaveInActiveFile;

        const summary = [
          success ? `${success} imported` : "",
          failed ? `${failed} failed` : "",
        ]
          .filter(Boolean)
          .join(", ");
        new Notice(`Batch import complete: ${summary}.`);
      },
    });

    // Command to clear checked items from the shopping list
    this.addCommand({
      id: c.CMD_CLEAR_SHOPPING_LIST,
      name: "Clear checked items from shopping list",
      callback: async () => {
        const listPath = normalizePath(this.settings.shoppingListFile);
        const listFile = this.app.vault.getAbstractFileByPath(listPath);
        if (!listFile || !(listFile instanceof TFile)) {
          new Notice("Shopping list file not found.");
          return;
        }
        const content = await this.app.vault.read(listFile);
        const { content: cleared, removed } = removeCheckedItems(content);
        if (removed === 0) {
          new Notice("No checked items to clear.");
          return;
        }
        await this.app.vault.process(listFile, () => cleared);
        new Notice(
          `Cleared ${removed} checked item${removed > 1 ? "s" : ""} from shopping list.`,
        );
      },
    });

    // Import a recipe from a JSON-LD or Cooklang file already in the vault.
    // Obsidian can't open either, so the command pops a picker; the file
    // explorer's right-click menu (registered below) is the other way in. The
    // id still says jsonld so hotkeys bound before Cooklang keep working.
    this.addCommand({
      id: c.CMD_IMPORT_JSONLD,
      name: "Import recipe from JSON-LD or Cooklang file",
      callback: () => {
        new PickRecipeFileModal(this.app, (file) => {
          void this.importRecipeFromFile(file);
        }).open();
      },
    });

    // Import every recipe file under a folder. The file explorer's folder
    // right-click menu (registered below) is the other way in.
    this.addCommand({
      id: c.CMD_IMPORT_FOLDER,
      name: "Import recipes from folder",
      callback: () => {
        new settings.FolderSuggestModal(this.app, (path) => {
          const folder = this.app.vault.getAbstractFileByPath(path);
          if (folder instanceof TFolder) {
            void this.importRecipesFromFolder(folder);
          }
        }).open();
      },
    });

    // Export the current recipe note as a portable JSON-LD file.
    this.addCommand({
      id: c.CMD_EXPORT_JSONLD,
      name: "Export recipe as JSON-LD file",
      callback: async () => {
        const file =
          this.app.workspace.getActiveViewOfType(MarkdownView)?.file ??
          this.app.workspace.getActiveViewOfType(CooklangView)?.file;
        if (!file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.exportRecipe(file, "jsonld");
      },
    });

    // Export the current recipe note as a Cooklang (.cook) file.
    this.addCommand({
      id: c.CMD_EXPORT_COOKLANG,
      name: "Export recipe as Cooklang file",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.exportRecipe(view.file, "cooklang");
      },
    });

    // The same actions from the file explorer's right-click menu, which is
    // the only place a .json file is reachable at all. A .cook file also
    // opens in the Cooklang view, which has its own import button.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (abstractFile instanceof TFolder) {
          const folder = abstractFile;
          menu.addItem((item) =>
            item
              .setTitle("Import recipes from folder")
              .setIcon("chef-hat")
              .onClick(() => void this.importRecipesFromFolder(folder)),
          );
          return;
        }
        if (!(abstractFile instanceof TFile)) return;
        const target = abstractFile;

        if (isImportableRecipeFile(target)) {
          menu.addItem((item) =>
            item
              .setTitle("Import as recipe")
              .setIcon("chef-hat")
              .onClick(() => void this.importRecipeFromFile(target)),
          );
          if (isCooklangFile(target)) {
            menu.addItem((item) =>
              item
                .setTitle("Export recipe as JSON-LD")
                .setIcon("braces")
                .onClick(() => void this.exportRecipe(target, "jsonld")),
            );
          }
          return;
        }

        if (target.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Export recipe as JSON-LD")
              .setIcon("braces")
              .onClick(() => void this.exportRecipe(target, "jsonld")),
          );
          menu.addItem((item) =>
            item
              .setTitle("Export recipe as Cooklang")
              .setIcon("file-text")
              .onClick(() => void this.exportRecipe(target, "cooklang")),
          );
        }
      }),
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new settings.SettingsTab(this.app, this));

    // Command to create a new manual recipe from the current template
    this.addCommand({
      id: c.CMD_NEW_RECIPE_STUB,
      name: "Add recipe (manual)",
      callback: () => {
        new NewRecipeModal(this.app, (recipeName) => {
          void this.createRecipeStub(recipeName);
        }).open();
      },
    });

    // Only in the palette with nutrition turned on.
    this.addCommand({
      id: c.CMD_BACKFILL_NUTRITION,
      name: "Fetch missing nutrition from source pages",
      checkCallback: (checking) => {
        if (!this.settings.showNutrition) return false;
        if (!checking) void this.backfillNutrition();
        return true;
      },
    });

    // Only in the palette while a run is going. Still there if nutrition is
    // turned off partway, so the run can be stopped.
    this.addCommand({
      id: c.CMD_STOP_NUTRITION,
      name: "Stop fetching nutrition",
      checkCallback: (checking) => {
        if (!this.nutritionRun) return false;
        if (!checking) this.nutritionRun.stopped = true;
        return true;
      },
    });

    // Command to rebuild the in-memory ingredient search index from each note's
    // body. Also strips the legacy `recipeIngredient` frontmatter that earlier
    // versions wrote into notes (the source of the mobile Properties bloat) —
    // the body's `### Ingredients` section is the single source of truth.
    this.addCommand({
      id: c.CMD_BACKFILL_INGREDIENTS,
      name: "Rebuild ingredient search index",
      callback: async () => {
        const files = getRecipeFiles(
          this.app.vault,
          this.getGalleryFolder(),
          this.templateFilePath(),
        );
        if (files.length === 0) {
          new Notice("No recipes found in the gallery folder.");
          return;
        }
        new Notice(`Indexing ingredients for ${files.length} recipes…`);
        this.ingredientIndex.clear();
        let cleaned = 0;
        for (const file of files) {
          try {
            this.ingredientIndex.set(
              file.path,
              await this.readIndexEntry(file),
            );
            if (isCooklangFile(file)) continue;
            // One-time cleanup of the old searchable frontmatter copy.
            const fmHasLegacy =
              this.app.metadataCache.getFileCache(file)?.frontmatter
                ?.recipeIngredient != null;
            if (fmHasLegacy) {
              await this.app.fileManager.processFrontMatter(
                file,
                (fm: JsonRecord) => {
                  delete fm.recipeIngredient;
                },
              );
              cleaned++;
            }
          } catch (err) {
            console.error(
              "Recipe Vault: ingredient indexing failed for",
              file.path,
              err,
            );
          }
        }
        this.queuePersistIngredientIndex();
        this.refreshRecipeGalleryView();
        new Notice(
          `Ingredient search ready — indexed ${files.length} recipes` +
            (cleaned > 0 ? `, removed old frontmatter from ${cleaned}.` : "."),
        );
      },
    });

    // Keep the in-memory ingredient index current as recipe notes change. The
    // index lives in the plugin's own data, so nothing is written to the notes
    // (covers manual notes, web imports, AI refinement, renames, and deletes).
    const reindexRecipe = (file: TAbstractFile) => {
      if (file instanceof TFile && this.isRecipeFile(file)) {
        void this.indexRecipeFile(file);
      }
    };
    this.registerEvent(this.app.vault.on("modify", reindexRecipe));
    this.registerEvent(this.app.vault.on("create", reindexRecipe));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.removeRecipeFromIndex(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.removeRecipeFromIndex(oldPath);
        reindexRecipe(file);
      }),
    );
  }

  onunload() {
    if (this.persistIndexTimer !== null) {
      window.clearTimeout(this.persistIndexTimer);
      this.persistIndexTimer = null;
    }
    void this.persistIngredientIndex();
  }

  refreshRecipeGalleryView() {
    for (const leaf of this.app.workspace.getLeavesOfType(
      c.VIEW_TYPE_RECIPE_GALLERY,
    )) {
      const view = leaf.view;
      if (view instanceof RecipeGalleryView) {
        view.refresh();
      }
    }
  }

  private async activateRecipeGalleryView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      c.VIEW_TYPE_RECIPE_GALLERY,
    );
    if (existing.length > 0) {
      this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Opening the gallery explicitly starts fresh — discard any search/sort
    // remembered from a previous navigate-into-recipe-and-back round trip.
    resetGalleryUiState();
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: c.VIEW_TYPE_RECIPE_GALLERY,
      active: true,
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      settings.DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<settings.PluginSettings>,
    );

    // The body image used to be a raw `({{image}})` link, which breaks when the
    // attachment folder has a space in it (#18). Patch just that token.
    const migrated = migrateImageLink(this.settings.recipeTemplate);
    if (migrated !== this.settings.recipeTemplate) {
      this.settings.recipeTemplate = migrated;
      await this.saveData(this.settings);
    }

    if (settings.migrateFillerWordSettings(this.settings)) {
      await this.saveData(this.settings);
    }

    // Presets get swapped for newer models over time. Move anyone still on a
    // retired preset to its replacement, so the dropdown doesn't fall back to
    // "Other (custom)" with an empty field.
    const replacement =
      settings.LEGACY_AI_MODEL_PRESETS[this.settings.aiModelPreset];
    if (replacement) {
      this.settings.aiModelPreset = replacement;
      this.settings.aiModelId = replacement;
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshRecipeGalleryView();
  }

  /** Set while a nutrition backfill runs, so a second one can't start. */
  private nutritionRun: { stopped: boolean } | null = null;

  /**
   * Fill in nutrition for the recipes that are missing it, from each one's
   * source page: the numbers, how big a serving is, and how many it serves.
   * Recipes imported before nutrition was a thing have the link but not
   * these. Asks first: it's a page load per recipe, so a big vault takes a
   * few minutes. Only adds, never changes a value that's there.
   */
  async backfillNutrition(): Promise<void> {
    if (this.nutritionRun) {
      new Notice("Already fetching nutrition.");
      return;
    }
    const targets = await this.nutritionTargets();
    if (targets.length === 0) {
      new Notice(
        "Every recipe with a source link already has its nutrition and servings.",
      );
      return;
    }

    const count = `${targets.length} recipe${targets.length === 1 ? "" : "s"}`;
    new ConfirmModal(this.app, {
      title: "Fetch missing nutrition",
      message:
        `${count} ${targets.length === 1 ? "has" : "have"} a source link but no nutrition, servings or serving size. ` +
        "This loads each source page, one at a time, and adds what it finds to the frontmatter. " +
        'Nothing that\'s already there changes. To stop partway, run "Stop fetching nutrition".',
      confirmText: "Fetch nutrition",
      onConfirm: () => void this.runNutritionBackfill(targets),
    }).open();
  }

  /**
   * Recipes in the gallery folder with a source link that are missing their
   * nutrition, their servings, or how big a serving is.
   */
  private async nutritionTargets(): Promise<NutritionTarget[]> {
    const targets: NutritionTarget[] = [];
    for (const file of getRecipeFiles(
      this.app.vault,
      this.getGalleryFolder(),
      this.templateFilePath(),
    )) {
      const summary = readRecipeFile(
        file.path,
        await this.app.vault.cachedRead(file),
        { photoProperty: this.photoProperty() },
      );
      if (!summary?.isRecipe) continue;
      if (summary.nutrition && summary.servings && summary.servingSize) {
        continue;
      }
      if (!/^https?:\/\//i.test(summary.sourceUrl)) continue;
      targets.push({ file, url: summary.sourceUrl, title: summary.title });
    }
    return targets;
  }

  /** The pause between source pages. Tests set it to 0. */
  nutritionFetchGapMs = 800;

  private async runNutritionBackfill(
    targets: NutritionTarget[],
  ): Promise<void> {
    // Two confirm dialogs open at once would otherwise start two runs.
    if (this.nutritionRun) return;
    const run = { stopped: false };
    this.nutritionRun = run;
    const progress = new Notice("", 0);
    // The run's own notice says how it's going. Core's per-fetch messages
    // ("trying again…") would pile up a stack of them.
    const options = { ...this.fetchOptions(), onProgress: undefined };

    let added = 0;
    let missing = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length && !run.stopped; i++) {
        const { file, url, title } = targets[i];
        progress.setMessage(
          `Fetching nutrition ${i + 1} of ${targets.length}: ${title}`,
        );
        try {
          const recipes = await core.fetchRecipes(url, this.httpPort, options);
          const info = pageNutrition(recipes, title);
          let changed = false;
          if (info) {
            await this.app.vault.process(file, (text) => {
              const next = addRecipeNutrition(file.path, text, info);
              changed = next !== text;
              return next;
            });
          }
          if (changed) added++;
          else missing++;
        } catch (err) {
          failed++;
          console.warn(
            "Recipe Vault: couldn't fetch nutrition for",
            file.path,
            err,
          );
        }
        // A pause between pages, like the batch import, so one site isn't
        // hit back to back.
        if (
          i < targets.length - 1 &&
          !run.stopped &&
          this.nutritionFetchGapMs
        ) {
          await sleep(this.nutritionFetchGapMs);
        }
      }
    } finally {
      progress.hide();
      this.nutritionRun = null;
    }

    const parts = [
      `Updated ${added} recipe${added === 1 ? "" : "s"}`,
      missing
        ? `${missing} source page${missing === 1 ? " had" : "s had"} nothing to add`
        : "",
      failed ? `${failed} couldn't be loaded (the console has which)` : "",
    ].filter(Boolean);
    new Notice(`${run.stopped ? "Stopped. " : ""}${parts.join(", ")}.`, 10000);
  }

  /**
   * Core's network capability, backed by Obsidian's `requestUrl` so imports
   * are not subject to CORS and work the same on desktop and mobile.
   */
  private httpPort: core.HttpPort = {
    get: async (url, headers) => {
      const res = await requestUrl({ url, method: "GET", headers });
      return { status: res.status, text: res.text };
    },
  };

  /** Forward the plugin's settings to core as parse/fetch options. */
  private fetchOptions(): core.FetchOptions {
    const s = this.settings;
    return {
      useBuiltInFillerWords: s.useBuiltInFillerWords ?? true,
      extraFillerWords: s.extraFillerWords,
      keptFillerWords: s.keptFillerWords,
      filterVeganWords: s.filterVeganWords ?? true,
      filterGlutenFreeWords: s.filterGlutenFreeWords ?? true,
      defaultLanguage: s.recipeLanguage || settings.obsidianLanguage(),
      proxyFallback: s.proxyFallback,
      retryDelayMs: this.fetchRetryDelayMs,
      sleep: (ms) => sleep(ms),
      onProgress: (message) => {
        new Notice(message);
      },
    };
  }

  /**
   * The main function to go get the recipe, and format it for the template
   */
  async fetchRecipes(url: string): Promise<ParsedRecipe[]> {
    return core.fetchRecipes(url, this.httpPort, this.fetchOptions());
  }

  /**
   * This function handles all the templating of the recipes
   */
  private addRecipeToMarkdown = async (url: string): Promise<void> => {
    try {
      const markdown = createRecipeRenderer(await this.getRecipeTemplate());
      const recipes = await this.fetchRecipes(url);

      // Avoid creating empty notes when no recipe schema is found.
      if (recipes?.length === 0) {
        new Notice(
          "No recipe data was found on that page. Try another URL or import manually.",
        );
        return;
      }

      // A .cook file is always its own file. It can't go into the open note.
      if (this.settings.recipeFormat === "cooklang") {
        for (const recipe of recipes) {
          await this.saveParsedRecipe(recipe, { source: "url" });
        }
        return;
      }

      // The open note is only written to when "Save in currently opened file"
      // is on. Otherwise the recipe goes straight into the file created below.
      // Don't look the view up again after opening that file: another plugin
      // (like Homepage) can keep a different note active, and the recipe
      // would land there instead.
      const view = this.settings.saveInActiveFile
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;

      let file: TFile | null = null; // this TFile instance is used by fetchImage() to get save folder path.

      // if there isn't a view due to settings or no current file open, lets create a file according to folder settings and open it
      if (!view) {
        if (this.settings.folder != "") {
          await this.folderCheck(this.settings.folder); // this checks if folder exists and creates it if it doesn't.
        }
        const vault = this.app.vault;
        // try and get recipe title
        const filename =
          recipes?.length > 0 && recipes?.[0]?.name
            ? (recipes[0].name as string)
                // replace disallowed characters
                .replace(/"|\*|\\|\/|<|>|:|\?/g, "")
            : new Date().getTime(); // Generate a unique timestamp

        const path =
          this.settings.folder === ""
            ? `${normalizePath(this.settings.folder)}${filename}.md`
            : `${normalizePath(this.settings.folder)}/${filename}.md`; // File path with timestamp and .md extension
        // Create a new untitled file with empty content
        file = await vault.create(path, "");

        // Open the newly created file
        await this.app.workspace.openLinkText(path, "", true);
      }

      // in debug, clear editor first
      if (this.settings.debug && view) {
        view.editor.setValue("");
      }

      // pages can have multiple recipes, lets add them all
      for (const recipe of recipes) {
        if (this.settings.debug) {
          console.debug(recipe);
          console.debug(markdown(recipe));
        }
        // this will download the images and replace the json "recipe.image" value with the path of the image file.
        if (this.settings.saveImg && file) {
          const rawName = recipe.name;
          const filename =
            typeof rawName === "string"
              ? rawName
                  // replace any whitespace with dashes
                  .replace(/\s+/g, "-")
                  // replace disallowed characters
                  .replace(/"|\*|\\|\/|<|>|:|\?/g, "")
              : "";
          if (!filename) {
            return;
          }

          if (this.settings.imgFolder != "") {
            await this.folderCheck(this.settings.imgFolder);
            if (this.settings.saveImgSubdir) {
              await this.folderCheck(this.settings.imgFolder + "/" + filename);
            }
          }
          // Getting the recipe main image (with a gallery thumbnail alongside)
          const imgFile = await this.fetchImage(
            filename,
            recipe.image,
            file,
            undefined,
            { thumbnail: true },
          );
          if (imgFile) {
            recipe.image = imgFile.path;
          }

          if (!Array.isArray(recipe.recipeInstructions)) {
            // No instruction list — skip instruction-image downloads but still
            // render and save the recipe.
            continue;
          }

          // Getting all the images in instructions. Schema.org expresses a
          // step image as a URL string or an array; only the array form is
          // rewritten in place to the saved attachment path.
          let imageCounter = 0;
          for (const instruction of recipe.recipeInstructions) {
            if (Array.isArray(instruction.image)) {
              const images = instruction.image as unknown[];
              const imgFile = await this.fetchImage(
                filename,
                images[0],
                file,
                imageCounter,
              );
              if (imgFile) {
                imageCounter += 1;
                images[0] = imgFile.path;
              }
              // Not sure if this would occur, but in theory it's possible
            } else if (instruction.itemListElement) {
              for (const element of instruction.itemListElement) {
                if (Array.isArray(element.image)) {
                  const images = element.image as unknown[];
                  const imgFile = await this.fetchImage(
                    filename,
                    images[0],
                    file,
                    imageCounter,
                  );
                  if (imgFile) {
                    imageCounter += 1;
                    images[0] = imgFile.path;
                  }
                }
              }
            }
          }
        }
        // notice instead of just passing the recipe into markdown, we are
        // adding a key called 'json'. This is so we can see the raw json in the
        // template if a user wants it.
        let md = markdown({
          ...recipe,
          json: JSON.stringify(recipe, null, 2),
        });

        if (this.settings.decodeEntities) {
          md = decodeHtmlEntities(md);
        }

        md = ensureRequiredRecipeFrontmatter(
          md,
          {
            cookTime:
              typeof recipe.totalTime === "string"
                ? recipe.totalTime
                : undefined,
            image: typeof recipe.image === "string" ? recipe.image : undefined,
          },
          { photoProperty: this.photoProperty() },
        );
        if (this.settings.showNutrition) {
          md = addNoteNutrition(md, recipeNutritionInfo(recipe));
        }
        md = ensureRecipeNotesSection(
          md,
          normalizeRecipeNotes(recipe.recipeNotes),
        );

        if (file) {
          await this.app.vault.append(file, md);
        } else if (view?.getMode() === "source") {
          view.editor.replaceSelection(md);
        } else if (view?.file) {
          await this.app.vault.append(view.file, md);
        }
      }
    } catch (error) {
      console.error("Recipe Vault: import failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      // Longer dwell time (10s) so the actionable failure text is readable;
      // the default ~5s toast is easy to miss for a multi-sentence message.
      new Notice(`Recipe import failed: ${msg}`, 10000);
    }
  };

  /**
   * Creates a manual recipe note from the current template and opens it for editing.
   */
  private createRecipeStub = async (recipeName: string): Promise<void> => {
    const name = recipeName.trim();
    if (!name) return;

    if (this.settings.recipeFormat === "cooklang") {
      const folder = this.recipeSaveFolder();
      await this.folderCheck(folder);
      const safeName = name.replace(/"|\*|\\|\/|<|>|:|\?/g, "");
      const file = await this.app.vault.create(
        this.freeRecipePath(folder, safeName, "cook"),
        `---\ntitle: ${name}\n---\n\n`,
      );
      new Notice(`Recipe "${name}" created.`);
      // Straight into the editor, since there's nothing to read yet.
      await this.app.workspace.getLeaf("tab").setViewState({
        type: c.VIEW_TYPE_COOKLANG,
        state: { file: file.path, mode: "source" },
        active: true,
      });
      return;
    }

    const markdown = createRecipeRenderer(await this.getRecipeTemplate());
    const stub = { name };
    let md = markdown(stub);

    if (this.settings.decodeEntities) {
      md = decodeHtmlEntities(md);
    }

    md = ensureRequiredRecipeFrontmatter(
      md,
      {},
      { photoProperty: this.photoProperty() },
    );

    const folder =
      this.settings.folder !== ""
        ? this.settings.folder
        : c.MANUAL_RECIPE_DEFAULT_FOLDER;
    await this.folderCheck(folder);

    const safeName = name.replace(/"|\*|\\|\/|<|>|:|\?/g, "");
    let filePath = `${normalizePath(folder)}/${safeName}.md`;
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(filePath)) {
      filePath = `${normalizePath(folder)}/${safeName} (${counter}).md`;
      counter++;
    }

    const file = await this.app.vault.create(filePath, md);
    await this.app.fileManager.processFrontMatter(file, (fm: JsonRecord) => {
      fm.source = "manual";
    });
    new Notice(`Recipe "${name}" created.`);
    await this.app.workspace.openLinkText(file.path, "", true);
  };

  /**
   * Renders a single already-parsed recipe to a brand-new note using the same
   * template + frontmatter/notes helpers as the URL importer. Returns the
   * created file, or null on failure.
   *
   * The photo flow hands it a local image Blob; the JSON-LD flow leaves that
   * empty and lets the remote `recipe.image` URL be downloaded instead.
   * `opts.source` is written to frontmatter so the note records where it came
   * from. Uses the Vault API throughout so it works on mobile; `recipe.url` may
   * be empty (the template guards it).
   */
  private async saveParsedRecipe(
    recipe: ParsedRecipe,
    opts: {
      localImage?: Blob;
      source?: string;
      /** Save here instead of the recipe save folder. */
      folder?: string;
      /**
       * The vault file the recipe was imported from, kept as `source_file`
       * so a folder import can tell it was already imported.
       */
      sourceFile?: string;
      /**
       * For bulk imports: don't open the note or notice it, and throw on
       * failure so the caller can collect the error instead.
       */
      quiet?: boolean;
      /**
       * The `.cook` file's own text, when the recipe came from one. Saving as
       * Cooklang keeps it as written instead of rebuilding it, which would
       * lose its cookware and timers.
       */
      cooklangText?: string;
    } = {},
  ): Promise<TFile | null> {
    try {
      if (this.settings.recipeFormat === "cooklang") {
        const file = await this.saveCooklangRecipe(recipe, opts);
        if (!opts.quiet) {
          new Notice(`Recipe "${file.basename}" created.`);
          await this.openRecipe(this.app.workspace.getLeaf("tab"), file);
        }
        return file;
      }

      const rawName = typeof recipe.name === "string" ? recipe.name.trim() : "";
      // Mirror the URL importer's disallowed-char strip; fall back to a unique
      // timestamp when the transcription has no usable title.
      const safeName =
        rawName.replace(/"|\*|\\|\/|<|>|:|\?/g, "").trim() ||
        String(new Date().getTime());

      const folder = opts.folder ?? this.recipeSaveFolder();
      await this.folderCheck(folder);

      let notePath = `${normalizePath(folder)}/${safeName}.md`;
      let counter = 2;
      while (this.app.vault.getAbstractFileByPath(notePath)) {
        notePath = `${normalizePath(folder)}/${safeName} (${counter}).md`;
        counter++;
      }

      // Create the note up front so the attachment-path helper can anchor the
      // image next to it when no dedicated image folder is configured.
      const file = await this.app.vault.create(notePath, "");

      if (!opts.localImage && this.settings.saveImg) {
        // A JSON-LD file points at a remote photo. Pull it into the vault now,
        // otherwise the note breaks the day that host goes away.
        await this.saveRemoteMainImage(recipe, file);
      }

      if (opts.localImage) {
        // Name the image from the note's final (de-duplicated) basename, not the
        // raw title: two recipes both titled "Pancakes" get notes "Pancakes.md"
        // and "Pancakes (2).md", so their images must diverge too. Using the raw
        // title would resolve both to "Pancakes.jpg" and the second recipe would
        // silently reuse the first one's photo.
        const imagePath = await this.saveLocalRecipeImage(
          file.basename,
          opts.localImage,
          file,
        );
        if (imagePath) {
          recipe.image = imagePath;
        }
      }

      const markdown = createRecipeRenderer(await this.getRecipeTemplate());
      let md = markdown({
        ...recipe,
        json: JSON.stringify(recipe, null, 2),
      });

      if (this.settings.decodeEntities) {
        md = decodeHtmlEntities(md);
      }
      md = ensureRequiredRecipeFrontmatter(
        md,
        {
          cookTime:
            typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
          image: typeof recipe.image === "string" ? recipe.image : undefined,
        },
        { photoProperty: this.photoProperty() },
      );
      if (this.settings.showNutrition) {
        md = addNoteNutrition(md, recipeNutritionInfo(recipe));
      }
      md = ensureRecipeNotesSection(
        md,
        normalizeRecipeNotes(recipe.recipeNotes),
      );

      await this.app.vault.modify(file, md);
      const source = opts.source ?? "photo";
      // The template always writes `times_made: 0`, so any history carried in
      // by the import has to be put back afterwards.
      const vaultState = readRecipeVaultState(recipe);
      await this.app.fileManager.processFrontMatter(file, (fm: JsonRecord) => {
        fm.source = source;
        if (opts.sourceFile) {
          fm.source_file = opts.sourceFile;
        }
        if (vaultState.timesMade !== undefined) {
          fm.times_made = vaultState.timesMade;
        }
        if (vaultState.lastMade !== undefined) {
          fm.last_made = vaultState.lastMade;
        }
      });

      if (!opts.quiet) {
        new Notice(`Recipe "${rawName || safeName}" created.`);
        await this.app.workspace.openLinkText(file.path, "", true);
      }
      return file;
    } catch (error) {
      if (opts.quiet) throw error;
      console.error("Recipe Vault: photo save failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Recipe save failed: ${msg}`, 10000);
      return null;
    }
  }

  /**
   * Save a recipe as a `.cook` file in the save folder (or `opts.folder`).
   *
   * The photo is the one passed in, or the recipe's remote image when "Save
   * images" is on. With an image folder set it goes there, like a note's
   * photo, and the file's `image:` front matter points at it. With no image
   * folder it goes next to the file as `Name.jpg`, which is where Cooklang
   * looks on its own.
   */
  private async saveCooklangRecipe(
    recipe: ParsedRecipe,
    opts: {
      localImage?: Blob;
      folder?: string;
      sourceFile?: string;
      cooklangText?: string;
    },
  ): Promise<TFile> {
    const rawName = typeof recipe.name === "string" ? recipe.name.trim() : "";
    const safeName =
      rawName.replace(/"|\*|\\|\/|<|>|:|\?/g, "").trim() ||
      String(new Date().getTime());

    const folder = opts.folder ?? this.recipeSaveFolder();
    await this.folderCheck(folder);
    const path = this.freeRecipePath(folder, safeName, "cook");

    // A page's nutrition only goes in with nutrition turned on. A .cook file
    // brought in as it is keeps whatever it already says.
    let text =
      opts.cooklangText ??
      recipeToCooklang(
        this.settings.showNutrition
          ? recipe
          : { ...recipe, nutrition: undefined },
      );
    if (opts.sourceFile) {
      text = setCooklangMetadata(text, { "source file": opts.sourceFile });
    }
    const file = await this.app.vault.create(path, text);

    const remote =
      this.settings.saveImg &&
      typeof recipe.image === "string" &&
      /^https?:\/\//i.test(recipe.image)
        ? recipe.image
        : null;
    if (!opts.localImage && !remote) return file;

    try {
      let imagePath: string | null = null;
      if (this.settings.imgFolder === "") {
        const buffer = opts.localImage
          ? await opts.localImage.arrayBuffer()
          : (await requestUrl({ url: remote ?? "", method: "GET" }))
              .arrayBuffer;
        await this.saveCooklangPhoto(file, buffer);
      } else if (opts.localImage) {
        imagePath = await this.saveLocalRecipeImage(
          file.basename,
          opts.localImage,
          file,
        );
      } else {
        await this.saveRemoteMainImage(recipe, file);
        if (typeof recipe.image === "string" && recipe.image !== remote) {
          imagePath = recipe.image;
        }
      }
      if (imagePath) {
        const saved = imagePath;
        await this.app.vault.process(file, (current) =>
          setCooklangMetadata(current, { image: saved }),
        );
      }
    } catch (err) {
      // The recipe is saved either way. A remote image is still in its front
      // matter for the gallery to show.
      console.error("Recipe Vault: failed to save recipe photo", err);
    }
    return file;
  }

  /** Write `Name.<ext>` next to `Name.cook`, plus a gallery thumbnail. */
  private async saveCooklangPhoto(
    cookFile: TFile,
    buffer: ArrayBuffer,
  ): Promise<void> {
    const type = this.detectImageType(buffer);
    if (!type) return;
    const dir =
      cookFile.parent && !cookFile.parent.isRoot()
        ? `${cookFile.parent.path}/`
        : "";
    const path = normalizePath(`${dir}${cookFile.basename}.${type.ext}`);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createBinary(path, buffer);
    }
    await this.createThumbnail(buffer, type, path);
  }

  /** `folder/name.ext`, or `name (2).ext` and up when that's taken. */
  private freeRecipePath(folder: string, name: string, ext: string): string {
    let path = `${normalizePath(folder)}/${name}.${ext}`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = `${normalizePath(folder)}/${name} (${n}).${ext}`;
    }
    return path;
  }

  /**
   * Writes a user-supplied image Blob into the vault — respecting the image
   * folder settings, falling back to Obsidian's attachment location — and
   * generates a gallery thumbnail alongside it. Returns the saved vault path,
   * or null when the blob isn't a recognized image or the write fails.
   */
  private async saveLocalRecipeImage(
    baseName: string,
    blob: Blob,
    note: TFile,
  ): Promise<string | null> {
    try {
      const buffer = await blob.arrayBuffer();
      const type = this.detectImageType(buffer);
      if (!type) return null;

      const name = baseName.replace(/\s+/g, "-");
      let path: string;
      if (this.settings.imgFolder === "") {
        path = await (
          this.app.vault as VaultWithAttachments
        ).getAvailablePathForAttachments(name, type.ext, note);
      } else {
        await this.folderCheck(this.settings.imgFolder);
        if (this.settings.saveImgSubdir) {
          await this.folderCheck(`${this.settings.imgFolder}/${name}`);
          path = `${normalizePath(this.settings.imgFolder)}/${name}/${name}.${type.ext}`;
        } else {
          path = `${normalizePath(this.settings.imgFolder)}/${name}.${type.ext}`;
        }
      }

      const existing = this.app.vault.getAbstractFileByPath(path);
      const imageFile =
        existing instanceof TFile
          ? existing
          : await this.app.vault.createBinary(path, buffer);

      // Best-effort gallery thumbnail — failure just falls back to the full
      // image, so never let it abort the save.
      await this.createThumbnail(buffer, type, imageFile.path);

      return imageFile.path;
    } catch (err) {
      console.error("Recipe Vault: failed to save recipe photo", err);
      return null;
    }
  }

  /**
   * This function checks for an existing folder (creates if it doesn't exist)
   */
  private async folderCheck(foldername: string) {
    const vault = this.app.vault;
    // Walk down one level at a time. A folder import can ask for a path
    // several folders deep that doesn't exist yet.
    let path = "";
    for (const part of normalizePath(foldername).split("/")) {
      path = path ? `${path}/${part}` : part;
      if (vault.getAbstractFileByPath(path) instanceof TFolder) continue;
      await vault.createFolder(path);
    }
  }

  /** Where new recipe notes go: the save folder setting, or the default. */
  private recipeSaveFolder(): string {
    return normalizePath(
      this.settings.folder !== ""
        ? this.settings.folder
        : c.MANUAL_RECIPE_DEFAULT_FOLDER,
    );
  }

  /**
   * Detect common web image types from raw bytes using magic-byte signatures.
   * Returns { ext, mime } compatible with the former file-type library output,
   * or null when the format is unrecognised.
   */
  private detectImageType(
    buf: ArrayBuffer,
  ): { ext: string; mime: string } | null {
    const bytes = new Uint8Array(buf.slice(0, 12));
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { ext: "jpg", mime: "image/jpeg" };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return { ext: "png", mime: "image/png" };
    }
    // GIF: 47 49 46 38
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return { ext: "gif", mime: "image/gif" };
    }
    // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return { ext: "webp", mime: "image/webp" };
    }
    // SVG: text sniff – must contain an "<svg" element (covers both bare SVG
    // and XML-declared SVG while rejecting other XML documents)
    const head = new TextDecoder().decode(buf.slice(0, 256)).trimStart();
    if (
      head.startsWith("<svg") ||
      (head.startsWith("<?xml") && head.includes("<svg"))
    ) {
      return { ext: "svg", mime: "image/svg+xml" };
    }
    return null;
  }

  /**
   * This function fetches the image (as an array buffer) and saves as a file, returns the path of the file.
   * When `options.thumbnail` is set, a downscaled gallery thumbnail is also
   * generated alongside the saved image (see {@link createThumbnail}).
   */
  /**
   * Download a recipe's remote `image` into the vault and rewrite the field to
   * the saved path. No-op when the image is missing or already a local path.
   *
   * The URL importer does the same thing inline, plus the per-step instruction
   * images. Worth folding the two together, but that block returns out of the
   * whole import on a missing filename, so it isn't a clean lift.
   */
  private async saveRemoteMainImage(
    recipe: ParsedRecipe,
    file: TFile,
  ): Promise<void> {
    const image = recipe.image;
    if (typeof image !== "string" || !/^https?:\/\//i.test(image)) return;

    const rawName = recipe.name;
    const filename =
      typeof rawName === "string"
        ? rawName.replace(/\s+/g, "-").replace(/"|\*|\\|\/|<|>|:|\?/g, "")
        : "";
    if (!filename) return;

    if (this.settings.imgFolder != "") {
      await this.folderCheck(this.settings.imgFolder);
      if (this.settings.saveImgSubdir) {
        await this.folderCheck(this.settings.imgFolder + "/" + filename);
      }
    }

    const imgFile = await this.fetchImage(filename, image, file, undefined, {
      thumbnail: true,
    });
    if (imgFile) {
      recipe.image = imgFile.path;
    }
  }

  /**
   * Read a `.json` / `.jsonld` or `.cook` file into normalized recipes, or
   * say why it couldn't be.
   *
   * Both go through the same normalize pass as a web page. A Cooklang file is
   * built into a schema.org Recipe first, so from there on it's the same
   * import, and a JSON file with a Recipe nested in an `@graph`, a bare array,
   * or a single object all work. No `sourceUrl` is passed: a standalone file
   * has no page, so the recipe keeps whatever `url` it carries and gets none
   * if it has none.
   */
  private async readRecipesFromFile(
    file: TFile,
  ): Promise<
    | { recipes: ParsedRecipe[]; source: string; cooklangText?: string }
    | { error: string }
  > {
    const raw = await this.app.vault.read(file);

    if (isCooklangFile(file)) {
      const recipe = core.cooklangToJsonLd(raw, { name: file.basename });
      // The file name alone always makes a "recipe", so check for a body.
      if (!recipe.recipeIngredient && !recipe.recipeInstructions) {
        return { error: `${file.name} has no ingredients or steps in it.` };
      }
      return {
        recipes: core.parseRecipesFromJsonLd([recipe], this.fetchOptions()),
        source: "cooklang",
        cooklangText: raw,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { error: `${file.name} isn't valid JSON.` };
    }
    const recipes = core.parseRecipesFromJsonLd([json], this.fetchOptions());
    if (recipes.length === 0) {
      return {
        error: `No schema.org Recipe found in ${file.name}. It needs a node with "@type": "Recipe".`,
      };
    }
    return { recipes, source: "jsonld" };
  }

  /** Create recipe notes from one `.json` / `.jsonld` or `.cook` file. */
  importRecipeFromFile = async (file: TFile): Promise<void> => {
    const format = isCooklangFile(file) ? "Cooklang" : "JSON-LD";
    try {
      const read = await this.readRecipesFromFile(file);
      if ("error" in read) {
        new Notice(read.error);
        return;
      }

      let saved = 0;
      for (const [i, recipe] of read.recipes.entries()) {
        const note = await this.saveParsedRecipe(recipe, {
          source: read.source,
          sourceFile: sourceFileKey(file, i, read.recipes.length),
          cooklangText: read.cooklangText,
        });
        if (note) saved += 1;
      }

      // saveParsedRecipe already notices each note it creates, so only say
      // something here when one file turned into several.
      if (saved > 1) {
        new Notice(`Imported ${saved} recipes from ${file.name}.`);
      }
    } catch (error) {
      console.error(`Recipe Vault: ${format} import failed`, file.path, error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${format} import failed: ${msg}`, 10000);
    }
  };

  /**
   * Import every JSON-LD and Cooklang file under a folder. A folder this big
   * asks first, since the gallery gets slow with thousands of notes.
   */
  private async importRecipesFromFolder(folder: TFolder): Promise<void> {
    if (this.folderImportRunning) {
      new Notice("A folder import is already running.");
      return;
    }

    const files: TFile[] = [];
    Vault.recurseChildren(folder, (child) => {
      if (child instanceof TFile && isImportableRecipeFile(child)) {
        files.push(child);
      }
    });
    files.sort((a, b) => a.path.localeCompare(b.path));

    const name = folder.isRoot() ? "the vault" : folder.path;
    if (files.length === 0) {
      new Notice(`No .json or .cook recipe files in ${name}.`);
      return;
    }

    if (files.length >= c.BULK_IMPORT_WARN_AT) {
      new ConfirmModal(this.app, {
        title: "Import a lot of recipes?",
        message:
          `${name} has ${files.length.toLocaleString()} recipe files. ` +
          "Recipe Vault is meant for a personal collection, and the gallery " +
          "gets slow with thousands of notes. You could import the folders " +
          "you actually cook from instead.",
        confirmText: `Import all ${files.length.toLocaleString()}`,
        onConfirm: () => void this.runFolderImport(folder, files),
      }).open();
      return;
    }

    await this.runFolderImport(folder, files);
  }

  /**
   * Make a note for every recipe in `files`, keeping their folder structure
   * inside the recipe save folder: `Imports/Desserts/pie.json` picked from
   * `Imports` lands in `Recipes/Desserts/`.
   *
   * Safe to run again on the same folder. A recipe is skipped when a note
   * already has its url, or was made from the same file (`source_file`), so a
   * run that stops halfway picks up where it left off instead of making
   * doubles.
   *
   * Notes are made without opening each one or noticing it. One notice keeps
   * a running count, and files that fail are listed in an "Import errors"
   * note in the imported folder, so they can be fixed and the import run
   * again.
   */
  private async runFolderImport(
    folder: TFolder,
    files: TFile[],
  ): Promise<void> {
    this.folderImportRunning = true;
    const saveFolder = this.recipeSaveFolder();
    const base = folder.isRoot() ? "" : folder.path;
    const seen = await this.importedRecipeKeys();
    const progress = new Notice("", 0);
    const failures: string[] = [];
    let imported = 0;
    let skipped = 0;

    try {
      for (const [n, file] of files.entries()) {
        progress.setMessage(
          `Importing recipes: ${n + 1} of ${files.length.toLocaleString()}`,
        );
        try {
          const read = await this.readRecipesFromFile(file);
          if ("error" in read) {
            failures.push(`${file.path}: ${read.error}`);
            continue;
          }

          const dir =
            file.parent && !file.parent.isRoot() ? file.parent.path : "";
          const sub =
            base && dir.startsWith(`${base}/`)
              ? dir.slice(base.length + 1)
              : "";
          const target = sub
            ? normalizePath(`${saveFolder}/${sub}`)
            : saveFolder;

          for (const [i, recipe] of read.recipes.entries()) {
            const sourceFile = sourceFileKey(file, i, read.recipes.length);
            if ((recipe.url && seen.has(recipe.url)) || seen.has(sourceFile)) {
              skipped += 1;
              continue;
            }
            await this.saveParsedRecipe(recipe, {
              source: read.source,
              folder: target,
              sourceFile,
              quiet: true,
              cooklangText: read.cooklangText,
            });
            seen.add(sourceFile);
            if (recipe.url) seen.add(recipe.url);
            imported += 1;
          }
        } catch (error) {
          console.error("Recipe Vault: folder import failed", file.path, error);
          const msg = error instanceof Error ? error.message : String(error);
          failures.push(`${file.path}: ${msg}`);
        }
      }
    } finally {
      progress.hide();
      this.folderImportRunning = false;
    }

    const summary = [
      `Imported ${imported.toLocaleString()} recipe${imported === 1 ? "" : "s"}`,
    ];
    if (skipped > 0) {
      summary.push(`skipped ${skipped.toLocaleString()} already imported`);
    }
    if (failures.length > 0) {
      const logPath = normalizePath(
        base ? `${base}/Import errors.md` : "Import errors.md",
      );
      await this.writeImportErrors(logPath, failures);
      summary.push(
        `${failures.length.toLocaleString()} file${failures.length === 1 ? "" : "s"} failed (see ${logPath})`,
      );
    }
    new Notice(`${summary.join(", ")}.`, 15000);
  }

  /**
   * Every url and `source_file` already on a recipe in the vault. Notes are
   * read from the metadata cache, so they're cheap even with thousands.
   * `.cook` files have no cache and are read, using the index when it's
   * current for that file.
   */
  private async importedRecipeKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string" && value.trim()) keys.add(value.trim());
    };
    for (const file of this.app.vault.getFiles()) {
      if (isCooklangFile(file)) {
        const entry = this.ingredientIndex.get(file.path);
        let cook = entry?.mtime === file.stat.mtime ? entry.cook : undefined;
        if (!cook) cook = (await this.readIndexEntry(file)).cook;
        add(cook?.sourceUrl);
        add(cook?.sourceFile);
        continue;
      }
      if (file.extension !== "md") continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      add(fm.url);
      add(fm.source_file);
    }
    return keys;
  }

  /** List the files a folder import couldn't read, replacing any older list. */
  private async writeImportErrors(
    path: string,
    failures: string[],
  ): Promise<void> {
    const body = [
      `Recipe Vault couldn't import these files on ${new Date().toLocaleString()}.`,
      "Fix them and run the folder import again. Recipes that already imported are skipped.",
      "",
      ...failures.map((line) => `- ${line}`),
      "",
    ].join("\n");
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, body);
    } else {
      await this.app.vault.create(path, body);
    }
  }

  /**
   * Write a recipe note back out as a JSON-LD (`.json`) or Cooklang (`.cook`)
   * file next to it, so it can be handed to someone using a different recipe
   * app. A `.cook` file can go out as JSON-LD the same way.
   *
   * The note is what gets read, not a stored copy of the original import, so
   * any edits since come along. An existing export is overwritten: the note is
   * the source of truth and a stale export next to it is worse than none.
   */
  async exportRecipe(
    file: TFile,
    format: "jsonld" | "cooklang",
  ): Promise<void> {
    const label = format === "jsonld" ? "JSON-LD" : "Cooklang";
    try {
      const markdown = await this.app.vault.read(file);
      // A .cook file goes out through the same reader its import uses.
      // Exporting one as Cooklang would just copy it, so that isn't offered.
      const fromCooklang = isCooklangFile(file);
      const recipe = fromCooklang
        ? core.cooklangToJsonLd(markdown, { name: file.basename })
        : noteToJsonLd(markdown, {
            name: file.basename,
            photoProperty: this.photoProperty(),
          });

      if (!recipe.recipeIngredient && !recipe.recipeInstructions) {
        new Notice(
          fromCooklang
            ? `${file.basename} has no ingredients or steps to export.`
            : `${file.basename} has no Ingredients or Instructions section to export.`,
        );
        return;
      }

      const ext = format === "jsonld" ? "json" : "cook";
      const body =
        format === "jsonld"
          ? JSON.stringify(recipe, null, 2)
          : noteToCooklang(markdown, {
              name: file.basename,
              photoProperty: this.photoProperty(),
            });

      const folder = file.parent?.path ?? "";
      const outPath = normalizePath(
        folder === "" || folder === "/"
          ? `${file.basename}.${ext}`
          : `${folder}/${file.basename}.${ext}`,
      );

      const existing = this.app.vault.getAbstractFileByPath(outPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, body);
      } else {
        await this.app.vault.create(outPath, body);
      }

      new Notice(`Exported to ${outPath}`);
    } catch (error) {
      console.error(`Recipe Vault: ${label} export failed`, file.path, error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${label} export failed: ${msg}`, 10000);
    }
  }

  private async fetchImage(
    filename: string,
    imgUrl: unknown,
    file: TFile,
    imgNum?: number,
    options: { thumbnail?: boolean } = {},
  ): Promise<false | TFile> {
    if (typeof imgUrl !== "string" || !imgUrl) {
      return false;
    }
    const subDir = filename;
    const name = imgNum && !isNaN(imgNum) ? `${filename}_${imgNum}` : filename;

    try {
      const res = await requestUrl({
        url: imgUrl,
        method: "GET",
      });
      const type = this.detectImageType(res.arrayBuffer); // type of the image
      if (!type) {
        return false;
      }
      let path = "";
      if (this.settings.imgFolder === "") {
        // Resolve the save path from Obsidian's default attachment settings.
        // The helper is not part of the public Vault typings.
        path = await (
          this.app.vault as VaultWithAttachments
        ).getAvailablePathForAttachments(name, type.ext, file);
      } else if (this.settings.saveImgSubdir) {
        path = `${normalizePath(this.settings.imgFolder)}/${subDir}/${name}.${type.ext}`;
      } else {
        path = `${normalizePath(this.settings.imgFolder)}/${name}.${type.ext}`;
      }

      const fileByPath = this.app.vault.getAbstractFileByPath(path);
      const imageFile =
        fileByPath instanceof TFile
          ? fileByPath
          : await this.app.vault.createBinary(path, res.arrayBuffer);

      if (options.thumbnail) {
        // Best-effort — a failed thumbnail just means the gallery falls back to
        // the full image, so never let it abort the import.
        await this.createThumbnail(res.arrayBuffer, type, imageFile.path);
      }

      return imageFile;
    } catch {
      return false;
    }
  }

  /**
   * Downscale `source` to a small JPEG sibling next to `fullImagePath` so the
   * gallery loads a decode-cheap thumbnail instead of a full-resolution photo —
   * decoded-image memory is `naturalW × naturalH × 4` regardless of the ~220px
   * display size, which is what makes the gallery heavy on Android.
   *
   * Returns the saved thumbnail file, or null when no thumbnail is produced
   * (vector source, already small enough, unsupported environment, or any
   * failure) — callers treat null as "use the full image".
   */
  private async createThumbnail(
    source: ArrayBuffer,
    type: { ext: string; mime: string },
    fullImagePath: string,
  ): Promise<TFile | null> {
    // Vector images are already tiny and don't benefit from raster downscaling.
    if (type.ext === "svg") return null;

    const thumbPath = thumbPathForImage(fullImagePath);
    const existing = this.app.vault.getAbstractFileByPath(thumbPath);
    if (existing instanceof TFile) return existing;

    // `createImageBitmap` / canvas are renderer-only; guard so a headless or
    // older environment degrades to the full image instead of throwing.
    if (
      typeof createImageBitmap !== "function" ||
      typeof activeDocument === "undefined"
    ) {
      return null;
    }

    const MAX_EDGE = 480;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(new Blob([source], { type: type.mime }));
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= MAX_EDGE) {
        // Already small enough — keep the original, no second copy on disk.
        return null;
      }

      const scale = MAX_EDGE / longest;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = createEl("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7),
      );
      if (!blob) return null;

      const buffer = await blob.arrayBuffer();
      return await this.app.vault.createBinary(thumbPath, buffer);
    } catch (err) {
      console.error("Recipe Vault: thumbnail generation failed", err);
      return null;
    } finally {
      bitmap?.close();
    }
  }
}
