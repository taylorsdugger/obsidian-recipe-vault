import {
  App,
  MarkdownView,
  MarkdownPostProcessorContext,
  Plugin,
  Notice,
  requestUrl,
  normalizePath,
  TFolder,
  TFile,
  Vault,
} from "obsidian";
import * as handlebars from "handlebars";
import * as cheerio from "cheerio";

import * as c from "./constants";
import * as settings from "./settings";
import { LoadRecipeModal } from "./modal-load-recipe";
import { NewRecipeModal } from "./modal-new-recipe";
import {
  RefineRecipeModal,
  RecipeRefineModalData,
  RecipeRefineApplyResult,
} from "./modal-refine-recipe";
import { RecipeGalleryView } from "./view-recipe-gallery";
import { thumbPathForImage } from "./utils/recipeLoader";
import {
  requestRecipeEditSuggestion,
  requestRecipeChatResponse,
} from "./utils/openrouter";
import dateFormat from "dateformat";

interface ShoppingItem {
  checked: boolean;
  amount: number;
  unit: string;
  name: string;
  sources: string[];
  original: string;
}

interface MarkdownSectionRange {
  headingEnd: number;
  bodyStart: number;
  bodyEnd: number;
}

interface ParsedRecipeSections {
  recipeIngredient: string[];
  recipeInstructions: string[];
  ingredientRange: MarkdownSectionRange;
  instructionRange: MarkdownSectionRange;
}

type CommandExecutorApp = App & {
  commands: {
    executeCommandById(commandId: string): boolean;
  };
};

/** A plain object node from parsed JSON-LD (values are still untyped JSON). */
type JsonRecord = Record<string, unknown>;

/** Narrow an unknown JSON value to a plain object (not null, not an array). */
function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One normalized instruction line: a step or an item within a HowToSection. */
interface InstructionItem {
  text: string;
  image?: unknown;
}

/** A normalized recipe instruction — either a plain step or a HowToSection. */
interface InstructionStep {
  name?: string;
  text?: string;
  image?: unknown;
  itemListElement?: InstructionItem[];
}

/**
 * A recipe parsed from a page's JSON-LD and normalized for templating. JSON-LD
 * is free-form, so unknown-typed index access is intentional; the fields the
 * importer reads or writes are declared explicitly so they stay type-safe.
 */
interface ParsedRecipe {
  [key: string]: unknown;
  name?: unknown;
  image?: unknown;
  author?: unknown;
  url?: string;
  totalTime?: unknown;
  recipeIngredient?: string[];
  recipeInstructions?: InstructionStep[];
  recipeNotes?: string[];
}

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

  private decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };

    return value.replace(
      /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi,
      (match, entity) => {
        const token = String(entity);

        if (token.startsWith("#x") || token.startsWith("#X")) {
          const code = Number.parseInt(token.slice(2), 16);
          return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }

        if (token.startsWith("#")) {
          const code = Number.parseInt(token.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }

        return namedEntities[token.toLowerCase()] ?? match;
      },
    );
  }

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

  private findMarkdownSection(
    markdown: string,
    sectionTitle: string,
  ): MarkdownSectionRange | null {
    const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingRegex = new RegExp(`^#{1,6}\\s+${escapedTitle}\\s*$`, "im");
    const headingMatch = headingRegex.exec(markdown);
    if (!headingMatch || headingMatch.index === undefined) {
      return null;
    }

    const headingStart = headingMatch.index;
    const headingEnd = headingStart + headingMatch[0].length;
    const afterHeading = markdown.slice(headingEnd);
    const nextHeadingMatch = /\n#{1,6}\s+/.exec(afterHeading);
    const bodyEnd =
      nextHeadingMatch && nextHeadingMatch.index !== undefined
        ? headingEnd + nextHeadingMatch.index
        : markdown.length;

    return {
      headingEnd,
      bodyStart: headingEnd,
      bodyEnd,
    };
  }

  private parseSectionList(
    sectionBody: string,
    isIngredients: boolean,
  ): string[] {
    return sectionBody
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (isIngredients) {
          return line
            .replace(/^-\s*\[(?: |x|X)\]\s*/, "")
            .replace(/^-\s*/, "")
            .trim();
        }
        return line
          .replace(/^[-*]\s*/, "")
          .replace(/^\d+\.\s*/, "")
          .trim();
      })
      .filter((line) => line.length > 0);
  }

  private parseRecipeSections(markdown: string): ParsedRecipeSections | null {
    const ingredientRange = this.findMarkdownSection(markdown, "Ingredients");
    const instructionRange = this.findMarkdownSection(markdown, "Instructions");
    if (!ingredientRange || !instructionRange) {
      return null;
    }

    const recipeIngredient = this.parseSectionList(
      markdown.slice(ingredientRange.bodyStart, ingredientRange.bodyEnd),
      true,
    );
    const recipeInstructions = this.parseSectionList(
      markdown.slice(instructionRange.bodyStart, instructionRange.bodyEnd),
      false,
    );

    return {
      recipeIngredient,
      recipeInstructions,
      ingredientRange,
      instructionRange,
    };
  }

  private replaceRecipeSections(
    markdown: string,
    recipeIngredient: string[],
    recipeInstructions: string[],
  ): string {
    const parsed = this.parseRecipeSections(markdown);
    if (!parsed) {
      throw new Error(
        "Could not find both Ingredients and Instructions sections in this note.",
      );
    }

    const ingredientBody = recipeIngredient
      .map((line) => `- [ ] ${line}`)
      .join("\n");
    const instructionBody = recipeInstructions
      .map((line) => `- ${line}`)
      .join("\n");

    const replacements: Array<{ start: number; end: number; value: string }> = [
      {
        start: parsed.ingredientRange.bodyStart,
        end: parsed.ingredientRange.bodyEnd,
        value: `\n\n${ingredientBody}\n`,
      },
      {
        start: parsed.instructionRange.bodyStart,
        end: parsed.instructionRange.bodyEnd,
        value: `\n\n${instructionBody}\n`,
      },
    ].sort((a, b) => b.start - a.start);

    let nextMarkdown = markdown;
    for (const replacement of replacements) {
      nextMarkdown =
        nextMarkdown.slice(0, replacement.start) +
        replacement.value +
        nextMarkdown.slice(replacement.end);
    }

    return nextMarkdown;
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

    const requestRefineData = async (
      refinePrompt: string,
      loadingMessage = "Asking AI for recipe summary...",
    ): Promise<RecipeRefineModalData> => {
      const content = await this.app.vault.read(file);
      const parsed = this.parseRecipeSections(content);
      if (!parsed) {
        throw new Error(
          "Could not find Ingredients and Instructions sections to refine in this note.",
        );
      }

      if (
        parsed.recipeIngredient.length === 0 ||
        parsed.recipeInstructions.length === 0
      ) {
        throw new Error("Recipe is missing ingredient or instruction content.");
      }

      const loadingNotice = new Notice(loadingMessage, 0);

      try {
        const suggestion = await requestRecipeEditSuggestion({
          apiKey,
          model,
          prompt: refinePrompt,
          recipeIngredient: parsed.recipeIngredient,
          recipeInstructions: parsed.recipeInstructions,
          timeoutMs,
          systemPrompt: this.settings.aiSystemPrompt,
        });

        return {
          prompt: refinePrompt,
          summary: suggestion.summary,
          originalIngredients: parsed.recipeIngredient,
          originalInstructions: parsed.recipeInstructions,
          suggestedIngredients: suggestion.recipeIngredient,
          suggestedInstructions: suggestion.recipeInstructions,
          suggestEdits: suggestion.suggestEdits,
        };
      } finally {
        loadingNotice.hide();
      }
    };

    try {
      const initialData = await requestRefineData(prompt);

      new RefineRecipeModal(
        this.app,
        initialData,
        prompt,
        async (followUpPrompt) =>
          requestRefineData(followUpPrompt, "Asking AI follow-up..."),
        async (messages) =>
          requestRecipeChatResponse({
            apiKey,
            model,
            messages,
            timeoutMs,
            systemPrompt: this.settings.aiSystemPrompt,
          }),
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
          const updated = this.replaceRecipeSections(
            latestContent,
            result.recipeIngredient,
            result.recipeInstructions,
          );

          await this.app.vault.process(file, () => updated);
          new Notice("Applied AI recipe edits.");
        },
      ).open();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI request failed. Please try again.";
      new Notice(message, 8000);
    }
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

    this.registerHandlebarsHelpers();

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
        const newItems: ShoppingItem[] = checked.map((text) => {
          const parsed = this.parseShoppingLine(text);
          return parsed
            ? {
                checked: false,
                ...parsed,
                sources: [recipeName],
                original: text,
              }
            : {
                checked: false,
                amount: 0,
                unit: "",
                name: text.toLowerCase(),
                sources: [recipeName],
                original: text,
              };
        });

        // Read and parse existing shopping list
        const listPath = normalizePath(this.settings.shoppingListFile);
        const existingFile = this.app.vault.getAbstractFileByPath(listPath);
        const headerLines: string[] = [];
        const existingItems: ShoppingItem[] = [];

        if (existingFile && existingFile instanceof TFile) {
          const existingContent = await this.app.vault.read(existingFile);
          let foundFirstItem = false;
          for (const line of existingContent.split("\n")) {
            const isItem = /^- \[[ xX]\]/.test(line);
            if (!isItem && !foundFirstItem) {
              headerLines.push(line);
            } else if (isItem) {
              foundFirstItem = true;
              const isChecked = /^- \[[xX]\]/.test(line);
              const text = line.replace(/^- \[[ xX]\]\s*/, "");
              const parsed = this.parseShoppingLine(text);
              existingItems.push(
                parsed
                  ? { checked: isChecked, ...parsed, original: text }
                  : {
                      checked: isChecked,
                      amount: 0,
                      unit: "",
                      name: text.toLowerCase(),
                      sources: [],
                      original: text,
                    },
              );
            }
          }
          // Trim trailing blank header lines
          while (
            headerLines.length &&
            !headerLines[headerLines.length - 1].trim()
          ) {
            headerLines.pop();
          }
        }

        // Merge new items into existing list
        let mergedCount = 0;
        for (const newItem of newItems) {
          const match = existingItems.find((e) => e.name === newItem.name);
          if (match) {
            mergedCount++;
            if (match.unit === newItem.unit && newItem.unit !== "") {
              match.amount += newItem.amount;
            } else if (
              match.unit !== newItem.unit &&
              newItem.unit !== "" &&
              match.unit !== ""
            ) {
              const matchBase = this.toBaseAmount(match.amount, match.unit);
              const newBase = this.toBaseAmount(newItem.amount, newItem.unit);
              if (matchBase && newBase && matchBase.family === newBase.family) {
                const converted = this.fromBaseAmount(
                  matchBase.base + newBase.base,
                  matchBase.family,
                );
                match.amount = converted.amount;
                match.unit = converted.unit;
              } else {
                // Incompatible units — add as separate item
                existingItems.push(newItem);
              }
            } else {
              match.amount += newItem.amount;
            }
            if (!match.sources.includes(recipeName)) {
              match.sources.push(recipeName);
            }
          } else {
            existingItems.push(newItem);
          }
        }

        // Rebuild and write the file
        const header = headerLines.length
          ? headerLines.join("\n") + "\n\n"
          : "";
        const itemLines = existingItems.map((item) => {
          const check = item.checked ? "[x]" : "[ ]";
          const display =
            item.amount > 0 || item.unit
              ? `${this.formatIngredientAmount(item.amount, item.unit)} ${item.name}`
              : item.original;
          const src = item.sources.length
            ? ` *(${item.sources.join(", ")})*`
            : "";
          return `- ${check} ${display.trim()}${src}`;
        });
        const newContent = header + itemLines.join("\n") + "\n";

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
        const lines = content.split("\n");
        const kept = lines.filter((line) => !/^- \[[xX]\]/.test(line));
        // Remove any trailing blank lines left behind
        while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
        const removed = lines.filter((line) => /^- \[[xX]\]/.test(line)).length;
        if (removed === 0) {
          new Notice("No checked items to clear.");
          return;
        }
        await this.app.vault.process(listFile, () => kept.join("\n") + "\n");
        new Notice(
          `Cleared ${removed} checked item${removed > 1 ? "s" : ""} from shopping list.`,
        );
      },
    });

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
  }

  onunload() {}

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
   * The main function to go get the recipe, and format it for the template
   */
  async fetchRecipes(_url: string): Promise<ParsedRecipe[]> {
    let url: URL;
    try {
      url = new URL(_url);
    } catch {
      throw new Error("That doesn't look like a valid recipe URL.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Recipe URL must start with http:// or https://.");
    }

    // A URL fragment (`#wprm-recipe-container-…`) is client-side only and must
    // never be sent to the server. Desktop's network stack strips it
    // automatically, but Obsidian's mobile (Capacitor) `requestUrl` forwards
    // the fragment to the native HTTP client, which hosts reject (403/404) —
    // breaking "jump to recipe" imports on Android while they work on desktop.
    // Keep `url` (with the hash) for extractWprmRecipeNotes below; fetch clean.
    const fetchUrl = new URL(url.href);
    fetchUrl.hash = "";

    new Notice(`Fetching: ${fetchUrl.href}`);

    const reqHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    let response;
    try {
      response = await requestUrl({
        url: fetchUrl.href,
        method: "GET",
        headers: reqHeaders,
      });
    } catch (err) {
      // Some hosts' bot protection (e.g. Cloudflare) blocks the request
      // outright with a 403 — most often on mobile, where the native HTTP
      // client's fingerprint differs from a real browser. When enabled, retry
      // once through a public read proxy that fetches the page server-side.
      if (!this.settings.proxyFallback) {
        const detail = err instanceof Error ? ` (${err.message})` : "";
        throw new Error(
          `Could not fetch that page. Check the URL and your connection, then try again.${detail}`,
        );
      }

      try {
        new Notice("Direct fetch failed — retrying via proxy…");
        response = await requestUrl({
          url: `https://api.allorigins.win/raw?url=${encodeURIComponent(fetchUrl.href)}`,
          method: "GET",
          headers: reqHeaders,
        });
      } catch (proxyErr) {
        const detail =
          proxyErr instanceof Error ? ` (${proxyErr.message})` : "";
        throw new Error(
          `Could not fetch that page, even via the proxy fallback. Check the URL and your connection, then try again.${detail}`,
        );
      }
    }

    const $ = cheerio.load(response.text, {});

    /**
     * the main recipes list, we'll use to render from
     * its an array instead because a page can technically have multiple recipes on it
     */
    const recipes: ParsedRecipe[] = [];

    /**
     * Many sites (Yoast/WordPress, etc.) express the whole page as a single
     * JSON-LD `@graph` where nodes reference each other by `@id` instead of
     * inlining them — e.g. a Recipe's author is `{ "@id": ".../person/123" }`
     * pointing at a separate Person node. Index every node that carries an
     * `@id` so those references can be resolved back to the real object.
     */
    const nodesById = new Map<string, JsonRecord>();
    const indexNodes = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(indexNodes);
        return;
      }
      if (!isJsonRecord(value)) return;
      const id = value["@id"];
      // Only index real nodes (more than just an "@id" pointer).
      if (typeof id === "string" && Object.keys(value).length > 1) {
        if (!nodesById.has(id)) nodesById.set(id, value);
      }
      for (const key of Object.keys(value)) {
        indexNodes(value[key]);
      }
    };

    /** Follow a bare `{ "@id": "..." }` pointer to its indexed node. */
    const resolveRef = (value: unknown): unknown => {
      if (isJsonRecord(value) && Object.keys(value).length === 1) {
        const id = value["@id"];
        if (typeof id === "string") return nodesById.get(id) ?? value;
      }
      return value;
    };

    /** Reduce an author value (string | object | ref | array) to a plain name. */
    const authorName = (value: unknown): string => {
      const resolved = resolveRef(value);
      if (typeof resolved === "string") return resolved.trim();
      if (isJsonRecord(resolved)) {
        const name = resolved.name;
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    };

    /**
     * Reduce an ingredient value (string | object | `@id` ref) to a clean
     * line, resolving references and stripping any inline HTML.
     */
    const ingredientText = (value: unknown): string => {
      const resolved = resolveRef(value);
      if (typeof resolved === "string") return this.stripHtml(resolved);
      if (isJsonRecord(resolved)) {
        const text = resolved.name ?? resolved.text;
        return typeof text === "string" ? this.stripHtml(text) : "";
      }
      return "";
    };

    /**
     * Normalize one instruction entry into the shape the template expects: a
     * HowToSection `{ name, itemListElement: [{ text, image? }] }` or a plain
     * step `{ text, image? }`. Coerces bare strings, resolves `@id` refs, and
     * strips inline HTML from every text value. `image` is preserved verbatim
     * so the downstream instruction-image download loop is unaffected.
     */
    const normalizeInstructionStep = (step: unknown): InstructionStep => {
      const resolved = resolveRef(step);
      if (typeof resolved === "string") {
        return { text: this.stripHtml(resolved) };
      }
      if (!isJsonRecord(resolved)) {
        return { text: "" };
      }

      const type = resolved["@type"];
      const isSection = Array.isArray(type)
        ? type.includes("HowToSection")
        : type === "HowToSection";

      const rawItems = resolved.itemListElement;
      if (isSection || Array.isArray(rawItems)) {
        const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
        const itemListElement = list
          .map((el): InstructionItem => {
            const r = resolveRef(el);
            if (typeof r === "string") return { text: this.stripHtml(r) };
            if (isJsonRecord(r)) {
              return { text: this.stripHtml(r.text ?? r.name), image: r.image };
            }
            return { text: "" };
          })
          .filter((s) => s.text);
        return { name: this.stripHtml(resolved.name), itemListElement };
      }

      return {
        text: this.stripHtml(resolved.text ?? resolved.name),
        image: resolved.image,
      };
    };

    /**
     * Some details are in varying formats, for templating to be easier,
     * lets attempt to normalize them
     */
    const normalizeSchema = (node: JsonRecord): void => {
      const json = node as ParsedRecipe;
      json.url = url.href;
      this.normalizeImages(json);

      if (typeof node.name === "string") {
        json.name = this.cleanRecipeName(node.name);
      }

      // Ingredients may be a string, an array of strings, or objects — flatten
      // to a clean string[] so the template renders consistently.
      const rawIngredient = node.recipeIngredient;
      if (rawIngredient != null) {
        const list: unknown[] = Array.isArray(rawIngredient)
          ? rawIngredient
          : [rawIngredient];
        json.recipeIngredient = list.map(ingredientText).filter(Boolean);
      }

      // Instructions may be a single string, a single object, or an array of
      // strings / HowToStep / HowToSection. Coerce to an array of the shapes
      // the template understands; without this a string or single object makes
      // `{{#each recipeInstructions}}` iterate characters / object keys.
      const rawInstructions = node.recipeInstructions;
      if (rawInstructions != null) {
        const list: unknown[] = Array.isArray(rawInstructions)
          ? rawInstructions
          : [rawInstructions];
        json.recipeInstructions = list
          .map(normalizeInstructionStep)
          .filter((s) => (s.itemListElement?.length ?? 0) > 0 || s.text);
      }

      json.recipeNotes = this.normalizeRecipeNotes(node.recipeNotes);

      // Normalize author to a plain string, resolving any `@id` references.
      const rawAuthor = node.author;
      if (rawAuthor != null) {
        if (Array.isArray(rawAuthor)) {
          json.author = (rawAuthor as unknown[])
            .map((a) => authorName(a))
            .filter(Boolean)
            .join(", ");
        } else {
          json.author = authorName(rawAuthor);
        }
      }

      recipes.push(json);
    };

    /**
     * Schemas come in every arrangement: bare arrays, `@graph` wrappers, or a
     * Recipe nested under `mainEntity` / `mainEntityOfPage` / some custom key.
     * Walk the whole tree and normalize each real Recipe node. Dedupe by
     * reference, and skip bare `@id` pointers (a Recipe ref with no content) so
     * nested recipes are found without double-counting.
     */
    const seenRecipes = new Set<JsonRecord>();
    const isRecipeNode = (value: JsonRecord): boolean => {
      const type = value["@type"];
      return Array.isArray(type) ? type.includes("Recipe") : type === "Recipe";
    };
    const collectRecipes = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collectRecipes);
        return;
      }
      if (!isJsonRecord(value)) return;
      const isRealRecipe =
        isRecipeNode(value) &&
        (value.name != null ||
          value.recipeIngredient != null ||
          value.recipeInstructions != null);
      if (isRealRecipe) {
        if (!seenRecipes.has(value)) {
          seenRecipes.add(value);
          normalizeSchema(value);
        }
        return;
      }
      for (const key of Object.keys(value)) collectRecipes(value[key]);
    };

    // parse the dom of the page and look for any schema.org/Recipe
    const parsedBlocks: unknown[][] = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      const content = $(el).text()?.trim();
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        // Skip malformed ld+json blocks; other scripts on the page may still
        // contain a valid Recipe entry.
        return;
      }

      // to make things consistent, we'll put all recipes into an array
      const data = Array.isArray(json) ? (json as unknown[]) : [json];
      parsedBlocks.push(data);
    });

    // Index every node by `@id` first so `@id` references (e.g. an author
    // pointing at a Person node) resolve regardless of node ordering or which
    // script block they live in. Then walk the blocks for Recipe entries.
    parsedBlocks.forEach((data) => indexNodes(data));
    parsedBlocks.forEach((data) => collectRecipes(data));

    // Fallback for WordPress Recipe Maker pages where notes may not be in JSON-LD.
    const fallbackNotes = this.extractWprmRecipeNotes($, url.hash);
    if (fallbackNotes.length > 0) {
      const hasNotesInSchema = recipes.some(
        (recipe) => this.normalizeRecipeNotes(recipe.recipeNotes).length > 0,
      );
      if (!hasNotesInSchema && recipes[0]) {
        recipes[0].recipeNotes = fallbackNotes;
      }
    }

    return recipes;
  }

  /**
   * This function handles all the templating of the recipes
   */
  private addRecipeToMarkdown = async (url: string): Promise<void> => {
    const markdown = handlebars.compile(this.settings.recipeTemplate);
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
          md = this.decodeHtmlEntities(md);
        }

        md = this.ensureRequiredRecipeFrontmatter(md, {
          cookTime:
            typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
          image: typeof recipe.image === "string" ? recipe.image : undefined,
        });
        md = this.ensureRecipeNotesSection(
          md,
          this.normalizeRecipeNotes(recipe.recipeNotes),
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
      new Notice(`Recipe import failed: ${msg}`);
    }
  };

  /**
   * Creates a manual recipe note from the current template and opens it for editing.
   */
  private createRecipeStub = async (recipeName: string): Promise<void> => {
    const name = recipeName.trim();
    if (!name) return;

    const markdown = handlebars.compile(this.settings.recipeTemplate);
    const stub = { name };
    let md = markdown(stub);

    if (this.settings.decodeEntities) {
      md = this.decodeHtmlEntities(md);
    }

    md = this.ensureRequiredRecipeFrontmatter(md, {});

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
   * Registers all Handlebars helpers used by recipe templates.
   * Called once from onload() so helpers are available to all template paths.
   */
  private registerHandlebarsHelpers(): void {
    handlebars.registerHelper("splitTags", function (tags) {
      if (!tags || typeof tags != "string") {
        return "";
      }
      const tagsArray = tags.split(",");
      let tagString = "";
      for (const tag of tagsArray) {
        tagString += "- " + tag.trim() + "\n";
      }
      return tagString;
    });

    const formatPhotoValue = this.formatPhotoValue.bind(this);
    handlebars.registerHelper("photoFrontmatter", function (imgPath) {
      if (!imgPath) return "";
      return formatPhotoValue(String(imgPath));
    });

    const formatIsoDuration = this.formatIsoDuration.bind(this);
    handlebars.registerHelper(
      "magicTime",
      function (arg1: unknown, arg2: unknown) {
        if (typeof arg1 === "undefined") {
          return "";
        }
        if (arguments.length === 1) {
          return dateFormat(new Date(), "yyyy-mm-dd HH:MM");
        }
        const value = typeof arg1 === "string" ? arg1 : String(arg1);
        if (arguments.length === 2) {
          if (!isNaN(Date.parse(value))) {
            return dateFormat(new Date(value), "yyyy-mm-dd HH:MM");
          }
          if (value.trim().startsWith("PT")) {
            return formatIsoDuration(value);
          }
          try {
            return dateFormat(new Date(), value);
          } catch {
            return "";
          }
        } else if (arguments.length === 3) {
          const mask = typeof arg2 === "string" ? arg2 : String(arg2);
          if (!isNaN(Date.parse(value))) {
            return dateFormat(new Date(value), mask);
          }
          return "Error in template or source";
        } else {
          return "Error in template";
        }
      },
    );
  }

  /**
   * Formats an image path/URL as a frontmatter photo value.
   * Local paths are wrapped in [[...]] (Obsidian wikilink); remote URLs are returned as-is.
   */
  private formatPhotoValue(imgPath: string): string {
    if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
      return imgPath;
    }
    return `[[${imgPath}]]`;
  }

  /**
   * Ensures required frontmatter keys exist even when users have customized/older templates.
   */
  private ensureRequiredRecipeFrontmatter(
    markdown: string,
    values: { cookTime?: string; image?: string },
  ): string {
    const cookTimeValue = this.normalizeCookTimeValue(values.cookTime);
    const photoValue = this.normalizePhotoValue(values.image).replace(
      /"/g,
      '\\"',
    );

    const requiredLines = [
      "cssclasses: recipe-note",
      `cook_time: ${cookTimeValue}`,
      `photo: "${photoValue}"`,
    ];

    if (markdown.startsWith("---\n")) {
      const frontmatterStart = 4;
      const frontmatterEnd = markdown.indexOf("\n---", frontmatterStart);
      if (frontmatterEnd !== -1) {
        let fmContent = markdown.slice(frontmatterStart, frontmatterEnd);
        const remainder = markdown.slice(frontmatterEnd + 4);

        const hasKey = (key: string): boolean =>
          new RegExp(`^${key}\\s*:`, "m").test(fmContent);

        const missingLines = requiredLines.filter((line) => {
          const key = line.split(":", 1)[0];
          return !hasKey(key);
        });

        if (missingLines.length === 0) {
          return markdown;
        }

        if (fmContent.length > 0 && !fmContent.endsWith("\n")) {
          fmContent += "\n";
        }
        fmContent += `${missingLines.join("\n")}\n`;

        const remainderPrefix = remainder.startsWith("\n") ? "" : "\n";
        return `---\n${fmContent}---${remainderPrefix}${remainder}`;
      }
    }

    return `---\n${requiredLines.join("\n")}\n---\n\n${markdown}`;
  }

  private normalizeCookTimeValue(raw?: string): string {
    if (!raw) return "";
    return raw.trim().startsWith("PT") ? this.formatIsoDuration(raw) : raw;
  }

  private normalizePhotoValue(raw?: string): string {
    if (!raw) return "";
    return this.formatPhotoValue(raw);
  }

  private normalizeRecipeNotes(raw: unknown): string[] {
    if (!raw) return [];

    if (typeof raw === "string") {
      const note = raw.trim();
      return note ? [note] : [];
    }

    if (!Array.isArray(raw)) return [];

    const notes = raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text.trim() : "";
        }
        return "";
      })
      .filter((item) => item.length > 0);

    return [...new Set(notes)];
  }

  private extractWprmRecipeNotes(
    $: ReturnType<typeof cheerio.load>,
    urlHash: string,
  ): string[] {
    const selectorCandidates: string[] = [];
    const hashId = urlHash?.replace(/^#/, "").trim();

    if (hashId) {
      selectorCandidates.push(
        `#${hashId} .wprm-recipe-notes`,
        `#${hashId} .wprm-recipe-notes-container`,
      );
    }

    selectorCandidates.push(
      ".wprm-recipe .wprm-recipe-notes",
      ".wprm-recipe .wprm-recipe-notes-container",
      ".wprm-recipe-notes",
      ".wprm-recipe-notes-container",
    );

    for (const selector of selectorCandidates) {
      const el = $(selector).first();
      if (!el || el.length === 0) continue;

      const text = el
        .text()
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
        .trim();

      if (!text) continue;

      const cleaned = text.replace(/^notes\s*:?\s*/i, "").trim();
      if (!cleaned) continue;

      return [cleaned];
    }

    return [];
  }

  private isRecipeNotesSectionEmpty(markdown: string): boolean {
    const headingMatch = markdown.match(/^##\s+Notes\s*$/m);
    if (!headingMatch || headingMatch.index === undefined) return true;

    const sectionStart = headingMatch.index + headingMatch[0].length;
    const afterHeading = markdown.slice(sectionStart);
    const nextHeadingMatch = afterHeading.match(/\n##\s+/);
    const sectionBody =
      nextHeadingMatch && nextHeadingMatch.index !== undefined
        ? afterHeading.slice(0, nextHeadingMatch.index)
        : afterHeading;

    return sectionBody.trim().length === 0;
  }

  private ensureRecipeNotesSection(markdown: string, notes: string[]): string {
    if (notes.length === 0) return markdown;

    const headingMatch = markdown.match(/^##\s+Notes\s*$/m);
    const notesBody = `${notes.map((note) => `- ${note}`).join("\n")}\n`;

    if (!headingMatch || headingMatch.index === undefined) {
      const separator = markdown.endsWith("\n") ? "" : "\n";
      return `${markdown}${separator}\n## Notes\n\n${notesBody}`;
    }

    const sectionStart = headingMatch.index + headingMatch[0].length;
    const beforeSection = markdown.slice(0, sectionStart);
    const afterHeading = markdown.slice(sectionStart);
    const nextHeadingMatch = afterHeading.match(/\n##\s+/);
    const sectionBody =
      nextHeadingMatch && nextHeadingMatch.index !== undefined
        ? afterHeading.slice(0, nextHeadingMatch.index)
        : afterHeading;

    if (sectionBody.trim().length > 0) return markdown;

    const tail =
      nextHeadingMatch && nextHeadingMatch.index !== undefined
        ? afterHeading.slice(nextHeadingMatch.index)
        : "";

    return `${beforeSection}\n\n${notesBody}${tail}`;
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
   * Strips common filler/marketing words and dietary labels from a recipe name.
   * e.g. "Easy Vegan Gluten-Free Dumplings" => "Dumplings"
   */
  private cleanRecipeName(name: string): string {
    if (!name) return name;

    // Decode common HTML entities (e.g. &amp; → &, &amp;amp; → &)
    const entityMap: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&nbsp;": " ",
    };
    let cleaned = name;
    // Run twice to catch double-encoded entities like &amp;amp;
    for (let pass = 0; pass < 2; pass++) {
      for (const [entity, char] of Object.entries(entityMap)) {
        cleaned = cleaned.split(entity).join(char);
      }
    }

    const baseFillerWords = [
      "the\\s+ultimate",
      "the\\s+best",
      "must[- ]?try",
      "one[- ]?pot",
      "one[- ]?pan",
      "restaurant[- ]?style",
      "crowd[- ]?pleasing",
      "family[- ]?favorite",
      "weeknight",
      "ultimate",
      "incredible",
      "delicious",
      "homemade",
      "awesome",
      "classic",
      "perfect",
      "amazing",
      "lighter",
      "light",
      "skinny",
      "simple",
      "tasty",
      "great",
      "quick",
      "super",
      "easy",
      "best",
      "healthy",
      "flavorful",
      "favourite",
      "favorite",
      "famous",
      "authentic",
      "copycat",
      "yummy",
      "lazy",
      "fresh",
      "comfort",
      "cozy",
      "satisfying",
      "crispy",
      "juicy",
      "sticky",
      "tender",
    ];
    const veganWords = [
      "plant[- ]?based",
      "vegetarian",
      "vegan",
      "veggie",
      "meatless",
      "dairy[- ]?free",
      "df",
    ];
    const glutenFreeWords = [
      "gluten[- ]?free",
      "wheat[- ]?free",
      "flourless",
      "gf",
    ];

    const customWordPatterns = this.getCustomFillerWordPatterns();
    const mode = this.settings.fillerWordsMode ?? "auto";
    const activePatterns = new Set<string>(
      mode === "custom" ? customWordPatterns : baseFillerWords,
    );

    if (this.settings.filterVeganWords ?? true) {
      veganWords.forEach((word) => activePatterns.add(word));
    }
    if (this.settings.filterGlutenFreeWords ?? true) {
      glutenFreeWords.forEach((word) => activePatterns.add(word));
    }

    for (const word of activePatterns) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      cleaned = cleaned.replace(regex, "");
    }

    // Remove empty or whitespace-only parentheses left after keyword stripping
    cleaned = cleaned.replace(/\(\s*\)/g, "");

    // Tidy up leftover punctuation, symbols, and whitespace
    cleaned = cleaned.replace(/[\s,\-–—&|]+/g, " ").trim();

    // If the result is ALL CAPS (or mostly), convert to Title Case
    const upper = cleaned.replace(/\s/g, "");
    if (upper.length > 0 && upper === upper.toUpperCase()) {
      cleaned = cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Fall back to the original name if stripping removed everything
    return cleaned || name;
  }

  private getCustomFillerWordPatterns(): string[] {
    const raw = this.settings.customFillerWords || "";
    return raw
      .split(/[\n,]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 0)
      .map((word) => this.toLooseWordPattern(word));
  }

  private toLooseWordPattern(word: string): string {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(/\s+/g, "[-\\s]+");
  }

  /**
   * Format an ISO 8601 duration string (e.g. "PT1H30M") into a human-readable
   * string (e.g. "1h 30m "). Returns the original string if it doesn't start with "PT".
   */
  private formatIsoDuration(duration: string): string {
    const raw = duration.trim();
    if (!raw.startsWith("PT")) return raw;
    return raw
      .replace("PT", "")
      .replace("H", "h ")
      .replace("M", "m ")
      .replace("S", "s ");
  }

  /**
   * In order to make templating easier. Lets normalize the types of recipe images
   * to a single string url
   */
  /**
   * Strip inline HTML tags from a schema text value and collapse whitespace.
   * Each tag becomes a space so adjacent words aren't joined. Entity decoding
   * is intentionally left to the final, settings-gated decodeHtmlEntities pass.
   */
  private stripHtml(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeImages(recipe: ParsedRecipe): void {
    const image = recipe.image;
    if (typeof image === "string") {
      return;
    }

    if (Array.isArray(image)) {
      const first: unknown = image[0];
      if (typeof first === "string") {
        recipe.image = first;
        return;
      }
      if (isJsonRecord(first) && typeof first.url === "string") {
        recipe.image = first.url;
        return;
      }
    }

    /**
     * Although the spec does not show ImageObject as a top level option, it is
     * used in some big sites.
     */
    if (isJsonRecord(image) && typeof image.url === "string") {
      recipe.image = image.url;
    }
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
      typeof document === "undefined"
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

      const canvas = document.createElement("canvas");
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

  /**
   * Parse a shopping list line into its components.
   * e.g. "2 cups flour *(Dumplings)*" → { amount: 2, unit: "cup", name: "flour", sources: ["Dumplings"] }
   */
  private parseShoppingLine(
    text: string,
  ): Omit<ShoppingItem, "checked" | "original"> | null {
    if (!text.trim()) return null;

    // Replace unicode fractions with ASCII `n/d` so the numeric regex below
    // can parse them. A leading space keeps mixed numbers separate
    // ("1½" → "1 1/2"); decimals (" 0.5") must NOT be used here — the regex
    // only understands integers and `n/d`, so a decimal silently parses as 0.
    const ucFracs: [RegExp, string][] = [
      [/½/g, "1/2"],
      [/¼/g, "1/4"],
      [/¾/g, "3/4"],
      [/⅓/g, "1/3"],
      [/⅔/g, "2/3"],
      [/⅛/g, "1/8"],
      [/⅜/g, "3/8"],
      [/⅝/g, "5/8"],
      [/⅞/g, "7/8"],
    ];
    let s = text.trim();
    for (const [re, val] of ucFracs) s = s.replace(re, ` ${val}`);
    s = s.trim();

    // Normalise spaces around slashes in fractions so "1 /4" parses as "1/4"
    s = s.replace(/(\d+)\s+\/\s*(\d+)/g, "$1/$2");

    // Match a leading quantity as one token: a mixed number ("1 1/2"), a bare
    // fraction ("1/2"), or a whole number ("2"). Ordered alternation matters —
    // listing the fraction forms before the bare integer stops a fraction's
    // numerator (the "1" in "1/2") from being consumed as a standalone whole.
    const numRe = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*/;
    const numMatch = s.match(numRe);
    let amount = 0;
    let rest = s;
    if (numMatch) {
      const token = numMatch[1];
      const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
      const frac = token.match(/^(\d+)\/(\d+)$/);
      if (mixed) {
        amount = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
      } else if (frac) {
        amount = Number(frac[1]) / Number(frac[2]);
      } else {
        amount = parseFloat(token);
      }
      rest = s.slice(numMatch[0].length).trim();
    }

    // Try to extract a unit
    const unitMatch = rest.match(/^([a-zA-Z]+\.?)\s*/);
    let unit = "";
    let name = rest;
    if (unitMatch) {
      const normalized = this.normalizeIngredientUnit(unitMatch[1]);
      if (normalized) {
        unit = normalized;
        name = rest.slice(unitMatch[0].length).trim();
      }
    }

    // Extract sources annotation from end: *(Source1, Source2)*
    const srcMatch = name.match(/\s*\*\(([^)]+)\)\*\s*$/);
    let sources: string[] = [];
    if (srcMatch) {
      sources = srcMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      name = name.slice(0, name.length - srcMatch[0].length).trim();
    }

    // Strip parenthetical prep notes like "(, minced)" or "(packed)" or "(, finely diced)"
    name = name.replace(/\s*\([^)]*\)/g, "").trim();
    // Strip trailing comma-separated descriptors like ", minced" or ", or 2 pureed tomatoes"
    name = name.replace(/,.*$/, "").trim();

    return { amount, unit, name: name.toLowerCase().trim(), sources };
  }

  /** Normalize raw unit strings to a canonical form. Returns "" if not recognised. */
  private normalizeIngredientUnit(raw: string): string {
    const u = raw.toLowerCase().replace(/\.+$/, "");
    const map: Record<string, string> = {
      tsp: "tsp",
      t: "tsp",
      teaspoon: "tsp",
      teaspoons: "tsp",
      tbsp: "tbsp",
      tbl: "tbsp",
      tablespoon: "tbsp",
      tablespoons: "tbsp",
      cup: "cup",
      cups: "cup",
      c: "cup",
      oz: "oz",
      ounce: "oz",
      ounces: "oz",
      lb: "lb",
      lbs: "lb",
      pound: "lb",
      pounds: "lb",
      g: "g",
      gram: "g",
      grams: "g",
      kg: "kg",
      kilogram: "kg",
      kilograms: "kg",
      ml: "ml",
      milliliter: "ml",
      milliliters: "ml",
      millilitre: "ml",
      millilitres: "ml",
      l: "l",
      liter: "l",
      liters: "l",
      litre: "l",
      litres: "l",
      clove: "clove",
      cloves: "clove",
      slice: "slice",
      slices: "slice",
      piece: "piece",
      pieces: "piece",
      can: "can",
      cans: "can",
      package: "package",
      pkg: "package",
      packages: "package",
      bunch: "bunch",
      bunches: "bunch",
      pinch: "pinch",
      pinches: "pinch",
      sprig: "sprig",
      sprigs: "sprig",
      head: "head",
      heads: "head",
      handful: "handful",
      stalk: "stalk",
      stalks: "stalk",
    };
    return map[u] ?? "";
  }

  /** Convert an amount+unit to a base value for a unit family, enabling cross-unit addition. */
  private toBaseAmount(
    amount: number,
    unit: string,
  ): { base: number; family: string } | null {
    const volToTsp: Record<string, number> = {
      tsp: 1,
      tbsp: 3,
      cup: 48,
      ml: 0.2029,
      l: 202.9,
    };
    if (unit in volToTsp)
      return { base: amount * volToTsp[unit], family: "volume" };

    const weightToG: Record<string, number> = {
      g: 1,
      kg: 1000,
      oz: 28.35,
      lb: 453.6,
    };
    if (unit in weightToG)
      return { base: amount * weightToG[unit], family: "weight" };

    return null;
  }

  /** Convert a base amount back to the most readable unit in its family. */
  private fromBaseAmount(
    base: number,
    family: string,
  ): { amount: number; unit: string } {
    if (family === "volume") {
      if (base >= 48) return { amount: base / 48, unit: "cup" };
      if (base >= 3) return { amount: base / 3, unit: "tbsp" };
      return { amount: base, unit: "tsp" };
    }
    if (family === "weight") {
      if (base >= 1000) return { amount: base / 1000, unit: "kg" };
      if (base >= 453.6) return { amount: base / 453.6, unit: "lb" };
      if (base >= 28.35) return { amount: base / 28.35, unit: "oz" };
      return { amount: base, unit: "g" };
    }
    return { amount: base, unit: "" };
  }

  /** Format a numeric amount as a readable string with unicode fractions. */
  private formatIngredientAmount(amount: number, unit: string): string {
    if (amount === 0) return unit || "";
    const whole = Math.floor(amount);
    const frac = amount - whole;
    const knownFracs: [number, string][] = [
      [1 / 8, "⅛"],
      [1 / 4, "¼"],
      [1 / 3, "⅓"],
      [3 / 8, "⅜"],
      [1 / 2, "½"],
      [5 / 8, "⅝"],
      [2 / 3, "⅔"],
      [3 / 4, "¾"],
      [7 / 8, "⅞"],
    ];
    let fracStr = "";
    let closestDiff = Infinity;
    for (const [val, sym] of knownFracs) {
      const diff = Math.abs(frac - val);
      if (diff < closestDiff) {
        closestDiff = diff;
        fracStr = sym;
      }
    }
    if (closestDiff > 0.09) fracStr = ""; // not close enough to a known fraction
    const numStr =
      whole > 0 && fracStr
        ? `${whole}${fracStr}`
        : whole > 0
          ? `${whole}`
          : fracStr || `${Math.round(amount * 100) / 100}`;
    return unit ? `${numStr} ${unit}` : numStr;
  }
}
