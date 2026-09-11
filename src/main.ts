import {
  App,
  MarkdownView,
  MarkdownPostProcessorContext,
  Plugin,
  Notice,
  requestUrl,
  normalizePath,
  TAbstractFile,
  TFolder,
  TFile,
  Vault,
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
import { getRecipeFiles, thumbPathForImage } from "./utils/recipeLoader";
import { PhotoRecipeModal } from "./modal-photo-recipe";
import { PickJsonFileModal, isJsonLdFile } from "./modal-pick-json";
import {
  requestRecipeEditSuggestion,
  requestRecipeChatResponse,
  requestRecipeFromImage,
} from "./utils/openrouter";
import type { ChatMessage } from "./utils/openrouter";
import dateFormat from "dateformat";
import * as core from "@recipe-vault/core";
import {
  createRecipeRenderer,
  decodeHtmlEntities,
  ensureRecipeNotesSection,
  ensureRequiredRecipeFrontmatter,
  ingredientsFromBody,
  itemFromLine,
  mergeShoppingItems,
  normalizeRecipeNotes,
  noteToJsonLd,
  parseRecipeSections,
  readRecipeVaultState,
  replaceRecipeSections,
  parseShoppingListMarkdown,
  removeCheckedItems,
  renderShoppingListMarkdown,
} from "@recipe-vault/core";
import type {
  JsonRecord,
  ParsedRecipe,
  ShoppingItem,
} from "@recipe-vault/core";

/** One note's entry in the persisted ingredient search index. */
interface IngredientIndexEntry {
  /** The file's modified time when it was indexed, so we can skip re-reads. */
  mtime: number;
  /** Ingredient lines parsed from the note's body `### Ingredients` section. */
  ingredients: string[];
}

type CommandExecutorApp = App & {
  commands: {
    executeCommandById(commandId: string): boolean;
  };
};

/** Vault augmented with the (untyped) attachment-path helper Obsidian exposes. */
type VaultWithAttachments = Vault & {
  getAvailablePathForAttachments(
    fileName: string,
    extension: string,
    file: TFile | null,
  ): Promise<string>;
};

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

  private executeCommand(commandId: string): boolean {
    return (
      this.app as unknown as CommandExecutorApp
    ).commands.executeCommandById(commandId);
  }

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

  private isRecipeFile(file: TFile): boolean {
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

  private injectRecipeActions(
    el: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    const container =
      el.closest(".markdown-preview-sizer") ??
      el.querySelector(".markdown-preview-sizer") ??
      el.closest(".markdown-preview-view");
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const previewRoot = container.closest(
      ".markdown-preview-view, .markdown-source-view.mod-cm6",
    );
    const hasRecipeClassOnView =
      previewRoot instanceof HTMLElement &&
      previewRoot.classList.contains("recipe-note");

    if (!this.isRecipeFile(file) && !hasRecipeClassOnView) {
      return;
    }

    if (container.dataset.recipeActionsInjected === context.sourcePath) {
      return;
    }

    container.dataset.recipeActionsInjected = context.sourcePath;

    window.setTimeout(() => {
      if (!container.isConnected) {
        return;
      }

      this.insertRecipeActions(container, file);
    }, 0);
  }

  private insertRecipeActions(container: HTMLElement, file: TFile): void {
    const existing = container.querySelector(".recipe-note-actions");
    if (existing) {
      return;
    }

    const actions = createDiv({ cls: "recipe-note-actions" });

    const markMadeButton = actions.createEl("button", {
      cls: ["recipe-note-action-button", "primary"],
      text: "Mark as made",
      attr: { type: "button" },
    });
    markMadeButton.addEventListener("click", () => {
      void (async () => {
        await this.app.workspace.openLinkText(file.path, "", false);
        this.executeCommand(`${this.manifest.id}:${c.CMD_MARK_MADE}`);
      })();
    });

    const shoppingListButton = actions.createEl("button", {
      cls: "recipe-note-action-button",
      text: "Add ingredients to shopping list",
      attr: { type: "button" },
    });
    shoppingListButton.addEventListener("click", () => {
      void (async () => {
        await this.app.workspace.openLinkText(file.path, "", false);
        this.executeCommand(
          `${this.manifest.id}:${c.CMD_ADD_TO_SHOPPING_LIST}`,
        );
      })();
    });

    const aiControls = actions.createDiv({ cls: "recipe-note-ai-controls" });

    const aiPromptInput = aiControls.createEl("input", {
      cls: "recipe-note-ai-input",
      attr: {
        type: "text",
        placeholder: "Ask AI: swap ingredients, tweak steps, simplify prep...",
      },
    });

    const aiPromptButton = aiControls.createEl("button", {
      cls: "recipe-note-action-button",
      text: "Ask AI",
      attr: { type: "button" },
    });

    let aiRequestInFlight = false;
    const runAiRefine = async () => {
      const prompt = aiPromptInput.value.trim();
      if (!prompt) {
        new Notice("Enter a short edit request before asking AI.");
        return;
      }
      if (aiRequestInFlight) {
        return;
      }

      aiPromptInput.value = "";
      aiRequestInFlight = true;
      aiPromptButton.disabled = true;
      aiPromptButton.textContent = "Asking...";

      try {
        await this.askAiToRefineRecipe(file, prompt);
      } finally {
        aiRequestInFlight = false;
        aiPromptButton.disabled = false;
        aiPromptButton.textContent = "Ask AI";
      }
    };

    aiPromptButton.addEventListener("click", () => {
      void runAiRefine();
    });

    aiPromptInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void runAiRefine();
      }
    });

    const targetHeading = Array.from(
      container.querySelectorAll<HTMLElement>("h2, h3, h4"),
    ).find((heading) =>
      heading.textContent?.toLowerCase().includes("ingredients"),
    );

    if (targetHeading && targetHeading.parentElement) {
      targetHeading.parentElement.insertBefore(actions, targetHeading);
      return;
    }

    const title = container.querySelector("h1, .inline-title");
    const heroImage = container.querySelector("img");
    const insertAfter = heroImage ?? title;

    if (insertAfter?.parentElement) {
      insertAfter.parentElement.insertBefore(actions, insertAfter.nextSibling);
    } else {
      container.prepend(actions);
    }
  }

  /** Ingredient lines for a note path, for the gallery search (loadRecipes). */
  getIngredients(path: string): string[] {
    return this.ingredientIndex.get(path)?.ingredients ?? [];
  }

  /** Parse a recipe's body `### Ingredients` section into searchable lines. */
  private async parseIngredientsFromBody(file: TFile): Promise<string[]> {
    const content = await this.app.vault.cachedRead(file);
    return ingredientsFromBody(content);
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

  /** (Re)index a single recipe note from its body. Never writes to the note. */
  private async indexRecipeFile(file: TFile): Promise<void> {
    try {
      const ingredients = await this.parseIngredientsFromBody(file);
      this.ingredientIndex.set(file.path, {
        mtime: file.stat.mtime,
        ingredients,
      });
      this.queuePersistIngredientIndex();
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
    const files = getRecipeFiles(this.app.vault, galleryFolder);
    const seen = new Set<string>();
    let changed = false;

    for (const file of files) {
      seen.add(file.path);
      const existing = this.ingredientIndex.get(file.path);
      if (existing && existing.mtime === file.stat.mtime) continue;
      try {
        const ingredients = await this.parseIngredientsFromBody(file);
        this.ingredientIndex.set(file.path, {
          mtime: file.stat.mtime,
          ingredients,
        });
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

    // Turn the conversation into a single instruction for the edit model.
    const buildEditPrompt = (messages: ChatMessage[]): string => {
      const transcript = messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      return [
        "Based on this conversation, update the recipe accordingly:",
        "",
        transcript,
      ].join("\n");
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
            prompt: buildEditPrompt(messages),
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
    const defaultModel = "google/gemini-2.5-flash-lite";
    const preset = this.settings.aiModelPreset?.trim();

    if (preset && preset !== "__other__") {
      return preset;
    }

    const custom = this.settings.aiCustomModelId?.trim();
    if (custom) {
      return custom;
    }

    const legacy = this.settings.aiModelId?.trim();
    return legacy || defaultModel;
  }

  private queueInjectActiveRecipeActions(): void {
    window.setTimeout(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return;

      if (!this.isRecipeFile(view.file)) return;
      if (view.getMode() === "source") return;

      const container =
        view.containerEl.querySelector(".markdown-preview-sizer") ??
        view.containerEl.querySelector(".markdown-preview-view");
      if (!(container instanceof HTMLElement)) return;

      this.insertRecipeActions(container, view.file);
    }, 0);
  }

  async onload() {
    await this.loadSettings();
    await this.loadIngredientIndex();
    // Reconcile the index against the vault once files are ready — re-reads only
    // notes whose mtime changed since last launch, then refreshes the gallery.
    this.app.workspace.onLayoutReady(() => {
      void this.refreshIngredientIndex();
    });

    this.registerMarkdownPostProcessor((el, context) => {
      this.injectRecipeActions(el, context);
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.queueInjectActiveRecipeActions();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.queueInjectActiveRecipeActions();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.queueInjectActiveRecipeActions();
      }),
    );

    // Register the Recipe Gallery view
    this.registerView(
      c.VIEW_TYPE_RECIPE_GALLERY,
      (leaf) => new RecipeGalleryView(leaf, this),
    );

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
      callback: () => {
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
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.app.fileManager.processFrontMatter(
          view.file,
          (fm: JsonRecord) => {
            const current =
              typeof fm.times_made === "number" ? fm.times_made : 0;
            fm.times_made = current + 1;
            fm.last_made = dateFormat(new Date(), "yyyy-mm-dd");
          },
        );
        new Notice("Marked as made!");
      },
    });

    // Command to add checked ingredients to a shopping list file
    this.addCommand({
      id: c.CMD_ADD_TO_SHOPPING_LIST,
      name: "Add checked ingredients to shopping list",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }

        const content = await this.app.vault.read(view.file);
        const lines = content.split("\n");
        const recipeName = view.file.basename;

        // Find the Ingredients section and collect checked items
        let inIngredients = false;
        const checked: string[] = [];
        const newLines = lines.map((line) => {
          if (/^#{1,4}\s+Ingredients/i.test(line)) {
            inIngredients = true;
            return line;
          }
          if (inIngredients && /^#{1,4}\s/.test(line)) {
            inIngredients = false;
          }
          if (inIngredients && /^- \[x\]/i.test(line)) {
            checked.push(line.replace(/^- \[x\]\s*/i, "").trim());
            return line.replace(/^- \[x\]/i, "- [ ]");
          }
          return line;
        });

        if (checked.length === 0) {
          new Notice("No checked ingredients found.");
          return;
        }

        // Uncheck the items in the active recipe using the editor API.
        view.editor.setValue(newLines.join("\n"));

        // Parse new items
        const newItems: ShoppingItem[] = checked.map((text) =>
          itemFromLine(text, recipeName),
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
        const { items, mergedCount } = mergeShoppingItems(
          existingItems,
          newItems,
        );

        // Rebuild and write the file
        const newContent = renderShoppingListMarkdown(headerLines, items);

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

    // Import a recipe from a JSON-LD file already in the vault. Obsidian can't
    // open a .json file, so the command pops a picker; the file explorer's
    // right-click menu (registered below) is the other way in.
    this.addCommand({
      id: c.CMD_IMPORT_JSONLD,
      name: "Import recipe from JSON-LD file",
      callback: () => {
        new PickJsonFileModal(this.app, (file) => {
          void this.importRecipeFromJsonLdFile(file);
        }).open();
      },
    });

    // Export the current recipe note as a portable JSON-LD file.
    this.addCommand({
      id: c.CMD_EXPORT_JSONLD,
      name: "Export recipe as JSON-LD file",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.exportRecipeAsJsonLd(view.file);
      },
    });

    // Both actions from the file explorer's right-click menu, which is the
    // only place a .json file is reachable at all.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (!(abstractFile instanceof TFile)) return;
        const target = abstractFile;

        if (isJsonLdFile(target)) {
          menu.addItem((item) =>
            item
              .setTitle("Import as recipe")
              .setIcon("chef-hat")
              .onClick(() => void this.importRecipeFromJsonLdFile(target)),
          );
          return;
        }

        if (target.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Export recipe as JSON-LD")
              .setIcon("braces")
              .onClick(() => void this.exportRecipeAsJsonLd(target)),
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

    // Command to rebuild the in-memory ingredient search index from each note's
    // body. Also strips the legacy `recipeIngredient` frontmatter that earlier
    // versions wrote into notes (the source of the mobile Properties bloat) —
    // the body's `### Ingredients` section is the single source of truth.
    this.addCommand({
      id: c.CMD_BACKFILL_INGREDIENTS,
      name: "Rebuild ingredient search index",
      callback: async () => {
        const files = getRecipeFiles(this.app.vault, this.getGalleryFolder());
        if (files.length === 0) {
          new Notice("No recipes found in the gallery folder.");
          return;
        }
        new Notice(`Indexing ingredients for ${files.length} recipes…`);
        this.ingredientIndex.clear();
        let cleaned = 0;
        for (const file of files) {
          try {
            const ingredients = await this.parseIngredientsFromBody(file);
            this.ingredientIndex.set(file.path, {
              mtime: file.stat.mtime,
              ingredients,
            });
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

    // Migrate saved templates that predate the current template version.
    // When new required frontmatter fields are added, bump TEMPLATE_VERSION in constants.ts.
    if ((this.settings.templateVersion ?? 0) < c.TEMPLATE_VERSION) {
      this.settings.recipeTemplate = c.DEFAULT_TEMPLATE;
      this.settings.templateVersion = c.TEMPLATE_VERSION;
      await this.saveData(this.settings);
      new Notice(
        "Recipe Vault: your template was updated to include new fields (photo, cook_time, cssclasses). " +
          "You can customise it again in Settings.",
        8000,
      );
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshRecipeGalleryView();
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
      fillerWordsMode: s.fillerWordsMode ?? "auto",
      customFillerWords: s.customFillerWords,
      filterVeganWords: s.filterVeganWords ?? true,
      filterGlutenFreeWords: s.filterGlutenFreeWords ?? true,
      proxyFallback: s.proxyFallback,
      retryDelayMs: this.fetchRetryDelayMs,
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
    const markdown = createRecipeRenderer(this.settings.recipeTemplate);
    try {
      const recipes = await this.fetchRecipes(url);

      // Avoid creating empty notes when no recipe schema is found.
      if (recipes?.length === 0) {
        new Notice(
          "No recipe data was found on that page. Try another URL or import manually.",
        );
        return;
      }

      let view = this.settings.saveInActiveFile
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
        view = this.app.workspace.getActiveViewOfType(MarkdownView);
      }

      if (!view) {
        new Notice("Could not open a markdown view");
        return;
      }

      // in debug, clear editor first
      if (this.settings.debug) {
        view.editor.setValue("");
      }

      // pages can have multiple recipes, lets add them all
      for (const recipe of recipes) {
        if (this.settings.debug) {
          console.log(recipe);
          console.log(markdown(recipe));
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

        md = ensureRequiredRecipeFrontmatter(md, {
          cookTime:
            typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
          image: typeof recipe.image === "string" ? recipe.image : undefined,
        });
        md = ensureRecipeNotesSection(
          md,
          normalizeRecipeNotes(recipe.recipeNotes),
        );

        if (view.getMode() === "source") {
          view.editor.replaceSelection(md);
        } else if (view.file) {
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

    const markdown = createRecipeRenderer(this.settings.recipeTemplate);
    const stub = { name };
    let md = markdown(stub);

    if (this.settings.decodeEntities) {
      md = decodeHtmlEntities(md);
    }

    md = ensureRequiredRecipeFrontmatter(md, {});

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
    opts: { localImage?: Blob; source?: string } = {},
  ): Promise<TFile | null> {
    try {
      const rawName = typeof recipe.name === "string" ? recipe.name.trim() : "";
      // Mirror the URL importer's disallowed-char strip; fall back to a unique
      // timestamp when the transcription has no usable title.
      const safeName =
        rawName.replace(/"|\*|\\|\/|<|>|:|\?/g, "").trim() ||
        String(new Date().getTime());

      const folder =
        this.settings.folder !== ""
          ? this.settings.folder
          : c.MANUAL_RECIPE_DEFAULT_FOLDER;
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

      const markdown = createRecipeRenderer(this.settings.recipeTemplate);
      let md = markdown({
        ...recipe,
        json: JSON.stringify(recipe, null, 2),
      });

      if (this.settings.decodeEntities) {
        md = decodeHtmlEntities(md);
      }
      md = ensureRequiredRecipeFrontmatter(md, {
        cookTime:
          typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
        image: typeof recipe.image === "string" ? recipe.image : undefined,
      });
      md = ensureRecipeNotesSection(
        md,
        normalizeRecipeNotes(recipe.recipeNotes),
      );

      await this.app.vault.modify(file, md);
      const source = opts.source ?? "photo";
      // The template always writes `times_made: 0`, so any history carried in
      // by the import has to be put back afterwards.
      const vaultState = readRecipeVaultState(recipe as JsonRecord);
      await this.app.fileManager.processFrontMatter(file, (fm: JsonRecord) => {
        fm.source = source;
        if (vaultState.timesMade !== undefined) {
          fm.times_made = vaultState.timesMade;
        }
        if (vaultState.lastMade !== undefined) {
          fm.last_made = vaultState.lastMade;
        }
      });

      new Notice(`Recipe "${rawName || safeName}" created.`);
      await this.app.workspace.openLinkText(file.path, "", true);
      return file;
    } catch (error) {
      console.error("Recipe Vault: photo save failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Recipe save failed: ${msg}`, 10000);
      return null;
    }
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
    const folderPath = normalizePath(foldername);
    const folder = vault.getAbstractFileByPath(folderPath);
    if (folder && folder instanceof TFolder) {
      return;
    }
    await vault.createFolder(folderPath);
    return;
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
   * Create recipe notes from a `.json` / `.jsonld` file already in the vault.
   *
   * The file goes through the same normalize pass as a web page, so a Recipe
   * nested in an `@graph`, a bare array, or a single object all work. No
   * `sourceUrl` is passed: a standalone file has no page, so the recipe keeps
   * whatever `url` it carries and gets none if it has none.
   */
  private importRecipeFromJsonLdFile = async (file: TFile): Promise<void> => {
    try {
      const raw = await this.app.vault.read(file);

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        new Notice(`${file.name} isn't valid JSON.`);
        return;
      }

      const recipes = core.parseRecipesFromJsonLd([json], this.fetchOptions());
      if (recipes.length === 0) {
        new Notice(
          `No schema.org Recipe found in ${file.name}. It needs a node with "@type": "Recipe".`,
        );
        return;
      }

      let saved = 0;
      for (const recipe of recipes) {
        const note = await this.saveParsedRecipe(recipe, { source: "jsonld" });
        if (note) saved += 1;
      }

      // saveParsedRecipe already notices each note it creates, so only say
      // something here when one file turned into several.
      if (saved > 1) {
        new Notice(`Imported ${saved} recipes from ${file.name}.`);
      }
    } catch (error) {
      console.error("Recipe Vault: JSON-LD import failed", file.path, error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`JSON-LD import failed: ${msg}`, 10000);
    }
  };

  /**
   * Write a recipe note back out as a `.json` JSON-LD file next to it, so it
   * can be handed to someone using a different recipe app.
   *
   * The note is what gets read, not a stored copy of the original import, so
   * any edits since come along. An existing export is overwritten: the note is
   * the source of truth and a stale export next to it is worse than none.
   */
  private exportRecipeAsJsonLd = async (file: TFile): Promise<void> => {
    try {
      const markdown = await this.app.vault.read(file);
      const recipe = noteToJsonLd(markdown, { name: file.basename });

      if (!recipe.recipeIngredient && !recipe.recipeInstructions) {
        new Notice(
          `${file.basename} has no Ingredients or Instructions section to export.`,
        );
        return;
      }

      const folder = file.parent?.path ?? "";
      const outPath = normalizePath(
        folder === "" || folder === "/"
          ? `${file.basename}.json`
          : `${folder}/${file.basename}.json`,
      );
      const body = JSON.stringify(recipe, null, 2);

      const existing = this.app.vault.getAbstractFileByPath(outPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, body);
      } else {
        await this.app.vault.create(outPath, body);
      }

      new Notice(`Exported to ${outPath}`);
    } catch (error) {
      console.error("Recipe Vault: JSON-LD export failed", file.path, error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`JSON-LD export failed: ${msg}`, 10000);
    }
  };

  private async fetchImage(
    filename: string,
    imgUrl: unknown,
    file: TFile,
    imgNum?: number,
    options: { thumbnail?: boolean } = {},
  ): Promise<false | TFile> {
    if (!imgUrl) {
      return false;
    }
    const subDir = filename;
    const name = imgNum && !isNaN(imgNum) ? `${filename}_${imgNum}` : filename;

    try {
      const res = await requestUrl({
        url: String(imgUrl),
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

      const canvas = activeDocument.createElement("canvas");
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
