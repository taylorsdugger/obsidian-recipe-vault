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
} from "obsidian";
import * as handlebars from "handlebars";
import type { Recipe } from "schema-dts";
import * as cheerio from "cheerio";

import * as c from "./constants";
import * as settings from "./settings";
import { LoadRecipeModal } from "./modal-load-recipe";
import { NewRecipeModal } from "./modal-new-recipe";
import type { ImageRecipeResult } from "./modal-image-recipe";
import {
  RefineRecipeModal,
  RecipeRefineModalData,
  RecipeRefineApplyResult,
} from "./modal-refine-recipe";
import { RecipeGalleryView } from "./view-recipe-gallery";
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

export default class RecipeVault extends Plugin {
  settings: settings.PluginSettings;

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

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existing = frontmatter.cssclasses;
      if (Array.isArray(existing)) {
        frontmatter.cssclasses = existing.includes("recipe-note")
          ? existing
          : [...existing, "recipe-note"];
      } else if (typeof existing === "string" && existing.trim()) {
        const parts = existing.split(/[\s,]+/).filter(Boolean);
        if (!parts.includes("recipe-note")) {
          parts.push("recipe-note");
        }
        frontmatter.cssclasses = parts.join(" ");
      } else {
        frontmatter.cssclasses = "recipe-note";
      }
    });

    return true;
  }

  private isRecipeFile(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return false;

    const tags = fm.tags;
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

    const actions = document.createElement("div");
    actions.className = "recipe-note-actions";

    const markMadeButton = document.createElement("button");
    markMadeButton.type = "button";
    markMadeButton.className = "recipe-note-action-button primary";
    markMadeButton.textContent = "Mark as made";
    markMadeButton.addEventListener("click", async () => {
      await this.app.workspace.openLinkText(file.path, "", false);
      this.executeCommand(`${this.manifest.id}:${c.CMD_MARK_MADE}`);
    });

    const shoppingListButton = document.createElement("button");
    shoppingListButton.type = "button";
    shoppingListButton.className = "recipe-note-action-button";
    shoppingListButton.textContent = "Add ingredients to shopping list";
    shoppingListButton.addEventListener("click", async () => {
      await this.app.workspace.openLinkText(file.path, "", false);
      this.executeCommand(`${this.manifest.id}:${c.CMD_ADD_TO_SHOPPING_LIST}`);
    });

    actions.appendChild(markMadeButton);
    actions.appendChild(shoppingListButton);

    const aiControls = document.createElement("div");
    aiControls.className = "recipe-note-ai-controls";

    const aiPromptInput = document.createElement("input");
    aiPromptInput.type = "text";
    aiPromptInput.className = "recipe-note-ai-input";
    aiPromptInput.placeholder =
      "Ask AI: swap ingredients, tweak steps, simplify prep...";

    const aiPromptButton = document.createElement("button");
    aiPromptButton.type = "button";
    aiPromptButton.className = "recipe-note-action-button";
    aiPromptButton.textContent = "Ask AI";

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

    aiControls.appendChild(aiPromptInput);
    aiControls.appendChild(aiPromptButton);
    actions.appendChild(aiControls);

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
      new Notice("Set your OpenRouter API key in Recipe Pro settings first.");
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

          await this.app.vault.modify(file, updated);
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
    this.addRibbonIcon("utensils", "Open Recipe Gallery", () => {
      this.activateRecipeGalleryView();
    });

    // Command: open/reveal gallery
    this.addCommand({
      id: c.CMD_OPEN_RECIPE_GALLERY,
      name: "Open Recipe Gallery",
      callback: () => this.activateRecipeGalleryView(),
    });

    // This creates an icon in the left ribbon.
    this.addRibbonIcon("chef-hat", "Import Recipe", (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const selection = view?.editor.getSelection()?.trim();
      // try and make sure its a url
      if (selection?.startsWith("http") && selection.split(" ").length === 1) {
        this.addRecipeToMarkdown(selection);
      } else {
        new LoadRecipeModal(this.app, this.addRecipeToMarkdown).open();
      }
    });

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: c.CMD_OPEN_MODAL,
      name: "Import Recipe",
      callback: () => {
        new LoadRecipeModal(this.app, this.addRecipeToMarkdown).open();
      },
    });

    // Command to increment times_made on the active recipe file
    this.addCommand({
      id: c.CMD_MARK_MADE,
      name: "Mark Recipe as Made",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          new Notice("No active recipe file open.");
          return;
        }
        await this.app.fileManager.processFrontMatter(view.file, (fm) => {
          const current = typeof fm.times_made === "number" ? fm.times_made : 0;
          fm.times_made = current + 1;
          fm.last_made = dateFormat(new Date(), "yyyy-mm-dd");
        });
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

        // Uncheck the items in the recipe file
        await this.app.vault.modify(view.file, newLines.join("\n"));

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
          : "# Shopping List\n\n";
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
          await this.app.vault.modify(existingFile, newContent);
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
            await new Promise((r) => setTimeout(r, 800));
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
        await this.app.vault.modify(listFile, kept.join("\n") + "\n");
        new Notice(
          `Cleared ${removed} checked item${removed > 1 ? "s" : ""} from shopping list.`,
        );
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new settings.SettingsTab(this.app, this));

    /**
     * Command to update frontmatter properties on existing recipe files
     *
     * This is commented out since this is a DEBUG feature only.
     * You only need it when you need to backfill new properties into recipes
     * that do not have them. If you need to debug/develop, then comment this back in
     */
    // this.addCommand({
    //   id: c.CMD_UPDATE_RECIPES_PROPERTIES,
    //   name: "Update existing recipe properties",
    //   callback: async () => {
    //     const files = this.app.vault.getMarkdownFiles();
    //     let photoUpdated = 0;
    //     let authorUpdated = 0;
    //     let cookTimeUpdated = 0;
    //     let notesUpdated = 0;
    //     let cssClassesUpdated = 0;
    //     let skipped = 0;

    //     for (const file of files) {
    //       const cache = this.app.metadataCache.getFileCache(file);
    //       const fm = cache?.frontmatter;

    //       // Skip non-recipe files (must have "recipe" tag in frontmatter)
    //       if (!fm) continue;
    //       const tags = fm.tags;
    //       const isRecipe = Array.isArray(tags)
    //         ? tags.some((t: string) => t === "recipe")
    //         : tags === "recipe";
    //       if (!isRecipe) continue;

    //       let fileChanged = false;

    //       if (await this.ensureRecipeNoteCssClass(file)) {
    //         cssClassesUpdated++;
    //         fileChanged = true;
    //       }

    //       // Backfill photo if missing
    //       if (!fm.photo) {
    //         const content = await this.app.vault.read(file);
    //         const imgMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    //         if (imgMatch && imgMatch[1]) {
    //           const photoValue = this.formatPhotoValue(imgMatch[1]);
    //           await this.app.fileManager.processFrontMatter(
    //             file,
    //             (frontmatter) => {
    //               frontmatter.photo = photoValue;
    //             },
    //           );
    //           photoUpdated++;
    //           fileChanged = true;
    //         } else {
    //           skipped++;
    //         }
    //       }

    //       // Backfill author and cook_time if missing and a url is available
    //       const needsAuthor = !fm.author;
    //       const needsCookTime = !fm.cook_time;
    //       const content = await this.app.vault.read(file);
    //       const needsNotes = this.isRecipeNotesSectionEmpty(content);

    //       if ((needsAuthor || needsCookTime || needsNotes) && fm.url) {
    //         try {
    //           const recipes = await this.fetchRecipes(fm.url);
    //           const recipe = needsNotes
    //             ? recipes.find(
    //                 (r) =>
    //                   this.normalizeRecipeNotes((r as any).recipeNotes).length >
    //                   0,
    //               ) ?? recipes?.[0]
    //             : recipes?.[0];
    //           if (recipe) {
    //             let authorValue: string | undefined;
    //             let cookTimeValue: string | undefined;
    //             let notesContent = content;
    //             if (needsAuthor && recipe.author) {
    //               // normalizeSchema (called inside fetchRecipes) ensures author is a string
    //               authorValue = recipe.author as string;
    //             }
    //             if (needsCookTime && recipe.totalTime) {
    //               cookTimeValue = this.formatIsoDuration(
    //                 String(recipe.totalTime),
    //               );
    //             }
    //             if (needsNotes) {
    //               const recipeNotes = this.normalizeRecipeNotes(
    //                 (recipe as any).recipeNotes,
    //               );
    //               if (recipeNotes.length > 0) {
    //                 notesContent = this.ensureRecipeNotesSection(
    //                   content,
    //                   recipeNotes,
    //                 );
    //               }
    //             }
    //             if (authorValue !== undefined || cookTimeValue !== undefined) {
    //               await this.app.fileManager.processFrontMatter(
    //                 file,
    //                 (frontmatter) => {
    //                   if (authorValue !== undefined) {
    //                     frontmatter.author = authorValue;
    //                   }
    //                   if (cookTimeValue !== undefined) {
    //                     frontmatter.cook_time = cookTimeValue;
    //                   }
    //                 },
    //               );
    //               if (authorValue !== undefined) {
    //                 authorUpdated++;
    //                 fileChanged = true;
    //               }
    //               if (cookTimeValue !== undefined) {
    //                 cookTimeUpdated++;
    //                 fileChanged = true;
    //               }
    //             }

    //             if (notesContent !== content) {
    //               await this.app.vault.modify(file, notesContent);
    //               notesUpdated++;
    //               fileChanged = true;
    //             }
    //           }
    //         } catch (err) {
    //           console.warn(`Recipe Vault: failed to fetch ${fm.url}`, err);
    //         }
    //       }

    //       if (!fileChanged) {
    //         skipped++;
    //       }
    //     }

    //     new Notice(
    //       `Recipe property update complete: ${photoUpdated} photo, ${authorUpdated} author, ${cookTimeUpdated} cook_time, ${notesUpdated} notes, ${cssClassesUpdated} styled; ${skipped} skipped.`,
    //     );
    //   },
    // });

    // Command to create a new manual recipe from the current template
    this.addCommand({
      id: c.CMD_NEW_RECIPE_STUB,
      name: "Add recipe (manual)",
      callback: () => {
        new NewRecipeModal(this.app, this.createRecipeStub).open();
      },
    });

    // Command to create a recipe by scanning an image with OCR
    // Uses a dynamic import so that tesseract.js (and its WASM/Worker
    // bootstrap) is never evaluated at plugin startup — it only loads when
    // the user actually invokes this command. This is what allows the plugin
    // to load on Android where tesseract.js's startup code would otherwise
    // crash the entire bundle before onload() could run.
    this.addCommand({
      id: c.CMD_RECIPE_FROM_IMAGE,
      name: "Add recipe from image",
      callback: async () => {
        const { ImageRecipeModal } = await import("./modal-image-recipe");
        new ImageRecipeModal(
          this.app,
          this.createRecipeFromImage,
          this.settings.ocrStrictCleanup,
        ).open();
      },
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(c.VIEW_TYPE_RECIPE_GALLERY);
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
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: c.VIEW_TYPE_RECIPE_GALLERY,
      active: true,
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      settings.DEFAULT_SETTINGS,
      await this.loadData(),
    );

    // Migrate saved templates that predate the current template version.
    // When new required frontmatter fields are added, bump TEMPLATE_VERSION in constants.ts.
    if ((this.settings.templateVersion ?? 0) < c.TEMPLATE_VERSION) {
      this.settings.recipeTemplate = c.DEFAULT_TEMPLATE;
      this.settings.templateVersion = c.TEMPLATE_VERSION;
      await this.saveData(this.settings);
      new Notice(
        "Recipe Pro: your template was updated to include new fields (photo, cook_time, cssclasses). " +
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
  async fetchRecipes(_url: string): Promise<Recipe[]> {
    const url = new URL(_url);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return Promise.reject("Not a valid url");
    }

    new Notice(`Fetching: ${url.href}`);
    let response;

    try {
      response = await requestUrl({
        url: url.href,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      return Promise.reject("Not a valid url");
    }

    const $ = cheerio.load(response.text, {});

    /**
     * the main recipes list, we'll use to render from
     * its an array instead because a page can technically have multiple recipes on it
     */
    const recipes: Recipe[] = [];

    /**
     * Some details are in varying formats, for templating to be easier,
     * lets attempt to normalize them
     */
    const normalizeSchema = (json: Recipe): void => {
      json.url = url.href;
      json = this.normalizeImages(json);

      if (json.name) {
        json.name = this.cleanRecipeName(json.name as string);
      }

      if (typeof json.recipeIngredient === "string") {
        json.recipeIngredient = [json.recipeIngredient];
      }

      (json as any).recipeNotes = this.normalizeRecipeNotes(
        (json as any).recipeNotes,
      );

      // Normalize author to a plain string
      if (json.author) {
        const raw = json.author as any;
        if (Array.isArray(raw)) {
          (json as any).author = raw
            .map((a: any) => (typeof a === "string" ? a : a?.name ?? ""))
            .filter(Boolean)
            .join(", ");
        } else if (typeof raw === "object") {
          (json as any).author = raw?.name ?? "";
        }
        // if already a string, leave it as-is
      }

      recipes.push(json);
    };

    /**
     * Unfortunately, some schemas are arrays, some not. Some in @graph, some not.
     * Here we attempt to move all kinds into a single array of RecipeLeafs
     */
    function handleSchemas(schemas: any[]): void {
      schemas.forEach((schema) => {
        if ("@graph" in schema && Array.isArray(schema?.["@graph"])) {
          return handleSchemas(schema["@graph"]);
        } else {
          const _type = schema?.["@type"];

          if (
            Array.isArray(_type)
              ? _type.includes("Recipe")
              : schema?.["@type"] === "Recipe"
          ) {
            normalizeSchema(schema);
          }
        }
      });
    }

    // parse the dom of the page and look for any schema.org/Recipe
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
      handleSchemas(data as any[]);
    });

    // Fallback for WordPress Recipe Maker pages where notes may not be in JSON-LD.
    const fallbackNotes = this.extractWprmRecipeNotes($, url.hash);
    if (fallbackNotes.length > 0) {
      const hasNotesInSchema = recipes.some(
        (recipe) =>
          this.normalizeRecipeNotes((recipe as any).recipeNotes).length > 0,
      );
      if (!hasNotesInSchema && recipes[0]) {
        (recipes[0] as any).recipeNotes = fallbackNotes;
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

      // too often, the recipe isn't there or malformed, lets let the user know.
      if (recipes?.length === 0) {
        new Notice(
          "A validated recipe scheme was not found on this page, sorry!\n\nIf you think this is an error, please open an issue on github.",
        );
        return;
      }

      // pages can have multiple recipes, lets add them all
      for (const recipe of recipes) {
        if (this.settings.debug) {
          console.log(recipe);
          console.log(markdown(recipe));
        }
        // this will download the images and replace the json "recipe.image" value with the path of the image file.
        if (this.settings.saveImg && file) {
          const filename = (recipe?.name as string)
            // replace any whitespace with dashes
            ?.replace(/\s+/g, "-")
            // replace disallowed characters
            .replace(/"|\*|\\|\/|<|>|:|\?/g, "");
          if (!filename) {
            return;
          }

          if (this.settings.imgFolder != "") {
            await this.folderCheck(this.settings.imgFolder);
            if (this.settings.saveImgSubdir) {
              await this.folderCheck(this.settings.imgFolder + "/" + filename);
            }
          }
          // Getting the recipe main image
          const imgFile = await this.fetchImage(filename, recipe.image, file);
          if (imgFile) {
            recipe.image = imgFile.path;
          }

          if (!Array.isArray(recipe.recipeInstructions)) {
            // No instruction list — skip instruction-image downloads but still
            // render and save the recipe.
            continue;
          }

          // Getting all the images in instructions
          let imageCounter = 0;
          for (const instruction of recipe.recipeInstructions) {
            if (instruction.image) {
              const imgFile = await this.fetchImage(
                filename,
                instruction.image[0],
                file,
                imageCounter,
              );
              if (imgFile) {
                imageCounter += 1;
                instruction.image[0] = imgFile.path;
              }
              // Not sure if this would occur, but in theory it's possible
            } else if (instruction.itemListElement) {
              for (const element of instruction.itemListElement) {
                if (element.image) {
                  const imgFile = await this.fetchImage(
                    filename,
                    element.image[0],
                    file,
                    imageCounter,
                  );
                  if (imgFile) {
                    imageCounter += 1;
                    element.image[0] = imgFile.path;
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
          // hack to decode html entities - https://stackoverflow.com/questions/1147359/how-to-decode-html-entities-using-jquery
          const textArea = document.createElement("textarea");
          textArea.innerHTML = md;
          md = textArea.value;
        }

        md = this.ensureRequiredRecipeFrontmatter(md, {
          cookTime:
            typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
          image: typeof recipe.image === "string" ? recipe.image : undefined,
        });
        md = this.ensureRecipeNotesSection(
          md,
          this.normalizeRecipeNotes((recipe as any).recipeNotes),
        );

        if (view.getMode() === "source") {
          view.editor.replaceSelection(md);
        } else {
          await this.app.vault.append(view.file, md);
        }
      }
    } catch (error) {
      console.error("Recipe Pro: import failed", error);
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
      const textArea = document.createElement("textarea");
      textArea.innerHTML = md;
      md = textArea.value;
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
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.source = "manual";
    });
    new Notice(`Recipe "${name}" created.`);
    await this.app.workspace.openLinkText(file.path, "", true);
  };

  /**
   * Creates a recipe note from an image-scanned result and opens it for editing.
   */
  private createRecipeFromImage = async (
    result: ImageRecipeResult,
  ): Promise<void> => {
    const { recipe, imageOption, originalImageFile, differentImageFile } =
      result;
    const rawName = (recipe.name || "").trim();
    const cleanedName = this.cleanRecipeName(rawName).trim();
    const name = cleanedName || rawName || "Scanned Recipe";
    if (!name) return;

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

    // Save the chosen image file into the vault attachment folder
    let imagePath = "";
    const imgFile =
      imageOption === "use"
        ? originalImageFile
        : imageOption === "different"
          ? differentImageFile
          : undefined;
    if (imgFile) {
      const imgExt = imgFile.name.split(".").pop() ?? "jpg";
      const imgFolder =
        this.settings.imgFolder !== "" ? this.settings.imgFolder : folder;
      await this.folderCheck(imgFolder);

      const imgSafeName = safeName.replace(/\s+/g, "-");
      imagePath = `${normalizePath(imgFolder)}/${imgSafeName}.${imgExt}`;
      const buf = await imgFile.arrayBuffer();
      if (!this.app.vault.getAbstractFileByPath(imagePath)) {
        await this.app.vault.createBinary(imagePath, buf);
      }
    }

    // Build template data matching the shape used by addRecipeToMarkdown
    const templateData = {
      name,
      author: recipe.author,
      totalTime: recipe.totalTime,
      image: imagePath || undefined,
      recipeIngredient: recipe.recipeIngredient,
      recipeInstructions: recipe.recipeInstructions.map((step) => ({
        text: step,
      })),
    };

    const markdown = handlebars.compile(this.settings.recipeTemplate);
    let md = markdown(templateData);

    if (this.settings.decodeEntities) {
      const textArea = document.createElement("textarea");
      textArea.innerHTML = md;
      md = textArea.value;
    }

    md = this.ensureRequiredRecipeFrontmatter(md, {
      cookTime: recipe.totalTime,
      image: imagePath || undefined,
    });
    md = this.ensureRecipeNotesSection(
      md,
      this.normalizeRecipeNotes((recipe as any).recipeNotes),
    );

    const file = await this.app.vault.create(filePath, md);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.source = "image";
    });
    new Notice(`Recipe "${name}" created from image.`);
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
    handlebars.registerHelper("magicTime", function (arg1, arg2) {
      if (typeof arg1 === "undefined") {
        return "";
      }
      if (arguments.length === 1) {
        return dateFormat(new Date(), "yyyy-mm-dd HH:MM");
      } else if (arguments.length === 2) {
        if (!isNaN(Date.parse(arg1))) {
          return dateFormat(new Date(arg1), "yyyy-mm-dd HH:MM");
        }
        if (arg1.trim().startsWith("PT")) {
          return formatIsoDuration(arg1);
        }
        try {
          return dateFormat(new Date(), arg1);
        } catch (error) {
          return "";
        }
      } else if (arguments.length === 3) {
        if (!isNaN(Date.parse(arg1))) {
          return dateFormat(new Date(arg1), arg2);
        }
        return "Error in template or source";
      } else {
        return "Error in template";
      }
    });
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
    const vault = app.vault;
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
  private normalizeImages(recipe: Recipe): Recipe {
    if (typeof recipe.image === "string") {
      return recipe;
    }

    if (Array.isArray(recipe.image)) {
      const image = recipe.image?.[0];
      if (typeof image === "string") {
        recipe.image = image;
        return recipe;
      }
      if (image?.url) {
        recipe.image = image.url;
        return recipe;
      }
    }

    /**
     * Although the spec does not show ImageObject as a top level option, it is used in some big sites.
     */
    if ((recipe as any).image?.url) {
      recipe.image = (recipe as any)?.image?.url || "";
    }

    return recipe;
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
   */
  private async fetchImage(
    filename: Recipe["name"],
    imgUrl: Recipe["image"],
    file: TFile,
    imgNum?: number,
  ): Promise<false | TFile> {
    if (!imgUrl) {
      return false;
    }
    const subDir = filename;
    if (imgNum && !isNaN(imgNum)) {
      filename += "_" + imgNum.toString();
    }

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
        path = await (this.app.vault as any)?.getAvailablePathForAttachments(
          filename,
          type.ext,
          file,
        ); // fetches the exact save path to create the file according to obsidian default attachment settings
      } else if (this.settings.saveImgSubdir) {
        path = `${normalizePath(this.settings.imgFolder)}/${subDir}/${filename}.${type.ext}`;
      } else {
        path = `${normalizePath(this.settings.imgFolder)}/${filename}.${type.ext}`;
      }

      const fileByPath = app.vault.getAbstractFileByPath(path);
      if (fileByPath && fileByPath instanceof TFile) {
        return fileByPath;
      }

      return await app.vault.createBinary(path, res.arrayBuffer);
    } catch (err) {
      return false;
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

    // Replace unicode fractions with decimals
    const ucFracs: [RegExp, number][] = [
      [/½/g, 0.5],
      [/¼/g, 0.25],
      [/¾/g, 0.75],
      [/⅓/g, 1 / 3],
      [/⅔/g, 2 / 3],
      [/⅛/g, 0.125],
      [/⅜/g, 0.375],
      [/⅝/g, 0.625],
      [/⅞/g, 0.875],
    ];
    let s = text.trim();
    for (const [re, val] of ucFracs) s = s.replace(re, ` ${val}`);

    // Normalise spaces around slashes in fractions so "1 /4" parses as "1/4"
    s = s.replace(/(\d+)\s+\/\s*(\d+)/g, "$1/$2");

    // Match optional whole number + optional fraction (e.g. "1 1/2" or "1/2" or "2")
    const numRe = /^(\d+)?\s*(\d+\/\d+)?\s*/;
    const numMatch = s.match(numRe);
    let amount = 0;
    let rest = s;
    if (numMatch && (numMatch[1] || numMatch[2])) {
      if (numMatch[1]) amount += parseFloat(numMatch[1]);
      if (numMatch[2]) {
        const [n, d] = numMatch[2].split("/").map(Number);
        amount += n / d;
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
