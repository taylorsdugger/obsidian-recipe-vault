import { App, PluginSettingTab, Setting } from "obsidian";
import RecipeVault from "./main";
import * as c from "./constants";

export interface PluginSettings {
  folder: string;
  saveInActiveFile: boolean;
  imgFolder: string;
  saveImg: boolean;
  saveImgSubdir: boolean;
  recipeTemplate: string;
  templateVersion: number;
  decodeEntities: boolean;
  ocrStrictCleanup: boolean;
  debug: boolean;
  shoppingListFile: string;
  recipeGalleryFolder: string;
  openRouterApiKey: string;
  aiModelPreset: string;
  aiCustomModelId: string;
  aiModelId: string;
  aiTimeoutMs: number;
  fillerWordsMode: "auto" | "custom";
  customFillerWords: string;
  filterVeganWords: boolean;
  filterGlutenFreeWords: boolean;
}

const AI_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite ($)" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini ($)" },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku ($)" },
  { id: "minimax/minimax-m2.5", label: "MiniMax: MiniMax M2.5 ($)" },
];

const AI_MODEL_OTHER = "__other__";

export const DEFAULT_SETTINGS: PluginSettings = {
  folder: "",
  saveInActiveFile: false,
  imgFolder: "",
  saveImg: false,
  saveImgSubdir: false,
  recipeTemplate: c.DEFAULT_TEMPLATE,
  templateVersion: c.TEMPLATE_VERSION,
  decodeEntities: true,
  ocrStrictCleanup: true,
  debug: false,
  shoppingListFile: "Shopping List.md",
  recipeGalleryFolder: "Recipes/All Recipes",
  openRouterApiKey: "",
  aiModelPreset: "google/gemini-2.5-flash-lite",
  aiCustomModelId: "",
  aiModelId: "google/gemini-2.5-flash-lite",
  aiTimeoutMs: 45000,
  fillerWordsMode: "auto",
  customFillerWords: "",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
};

export class SettingsTab extends PluginSettingTab {
  plugin: RecipeVault;

  constructor(app: App, plugin: RecipeVault) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("settingsTemplate");

    new Setting(containerEl)
      .setName("Recipe save folder")
      .setDesc(
        "Default recipe import location. If empty, recipe will be imported in the Vault root.",
      )
      .addText((text) => {
        text
          .setPlaceholder("eg: Recipes")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Save in currently opened file")
      .setDesc(
        "Imports the recipe into an active document. if no active document, the above save folder setting will apply.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.saveInActiveFile)
          .onChange(async (value) => {
            this.plugin.settings.saveInActiveFile = value;
            await this.plugin.saveSettings();
          });
      });

    const saveImgDescription = document.createDocumentFragment();
    saveImgDescription.append(
      "Save images imported by recipes. If empty, will follow: Files and links > new attachment location. See ",
      saveImgDescription.createEl("a", {
        href: "TODO",
        text: "README",
      }),
      " for more info.",
    );

    new Setting(containerEl)
      .setName("Save images")
      .setDesc(saveImgDescription)
      .addText((text) => {
        text
          .setPlaceholder("eg: Recipes/RecipeImages")
          .setValue(this.plugin.settings.imgFolder)
          .onChange(async (value) => {
            this.plugin.settings.imgFolder = value.trim();
            await this.plugin.saveSettings();
          });
      })
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.saveImg)
          .onChange(async (value) => {
            this.plugin.settings.saveImg = value;
            await this.plugin.saveSettings();
          });
      });

    const saveImgSubdirDescription = document.createDocumentFragment();
    saveImgSubdirDescription.append(
      "Create a subdirectory for each recipe to store images. A parent directory needs to be set above.",
    );

    new Setting(containerEl)
      .setName("Save images in subdirectories")
      .setDesc(saveImgSubdirDescription)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.saveImgSubdir)
          .onChange(async (value) => {
            this.plugin.settings.saveImgSubdir = value;
            await this.plugin.saveSettings();
          });
      });

    const templateDescription = document.createDocumentFragment();
    templateDescription.append(
      "Here you can edit the Template for newly created files. See ",
      templateDescription.createEl("a", {
        href: "TODO",
        text: "README",
      }),
      " for more info.",
    );

    new Setting(containerEl)
      .setClass("settingsTemplateRow")
      .setName("Recipe template")
      .setDesc(templateDescription)
      .addButton((btn) =>
        btn
          .setButtonText("Reset to default")
          .setClass("settingsTemplateButton")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.recipeTemplate = c.DEFAULT_TEMPLATE;
            await this.plugin.saveSettings();
            this.display();
          }),
      )
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.recipeTemplate)
          .onChange(async (value) => {
            this.plugin.settings.recipeTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Decode Entities")
      .setDesc(
        "We decode entities in the recipe to make it more readable in edit mode. If you don't want this, just turn it off here!",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.decodeEntities)
          .onChange(async (value) => {
            this.plugin.settings.decodeEntities = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("OCR strict cleanup")
      .setDesc(
        "For image-scanned recipes, aggressively filters likely OCR garbage from title, ingredients, and instructions. Turn off if valid lines are being dropped.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.ocrStrictCleanup)
          .onChange(async (value) => {
            this.plugin.settings.ocrStrictCleanup = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Shopping list file")
      .setDesc(
        "Path to the file where checked ingredients are sent when using 'Add checked ingredients to shopping list'. Include a folder path to auto-create it (eg: Lists/Shopping List.md). Will be created if it doesn't exist.",
      )
      .addText((text) => {
        text
          .setPlaceholder("eg: Shopping List.md")
          .setValue(this.plugin.settings.shoppingListFile)
          .onChange(async (value) => {
            this.plugin.settings.shoppingListFile =
              value.trim() || "Shopping List.md";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Recipe gallery folder")
      .setDesc(
        "Folder to display in the Recipe Gallery panel. All markdown files in this folder (and subfolders) will appear as cards.",
      )
      .addText((text) => {
        text
          .setPlaceholder("eg: Recipes/All Recipes")
          .setValue(this.plugin.settings.recipeGalleryFolder)
          .onChange(async (value) => {
            this.plugin.settings.recipeGalleryFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("OpenRouter API key")
      .setDesc(
        "Used for Ask AI recipe edits. Stored in this vault config as plain text.",
      )
      .addText((text) => {
        text
          .setPlaceholder("sk-or-v1-...")
          .setValue(this.plugin.settings.openRouterApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openRouterApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("AI model ID")
      .setDesc(
        "Choose a default OpenRouter model for Ask AI. Prices are rough relative tiers.",
      )
      .addDropdown((dropdown) => {
        AI_MODEL_PRESETS.forEach((preset) => {
          dropdown.addOption(preset.id, preset.label);
        });
        dropdown.addOption(AI_MODEL_OTHER, "Other (custom)");

        const currentPreset = this.plugin.settings.aiModelPreset;
        const hasPreset = AI_MODEL_PRESETS.some((p) => p.id === currentPreset);
        dropdown.setValue(hasPreset ? currentPreset : AI_MODEL_OTHER);

        dropdown.onChange(async (value) => {
          this.plugin.settings.aiModelPreset = value;
          if (value !== AI_MODEL_OTHER) {
            this.plugin.settings.aiModelId = value;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (
      this.plugin.settings.aiModelPreset === AI_MODEL_OTHER ||
      !AI_MODEL_PRESETS.some((p) => p.id === this.plugin.settings.aiModelPreset)
    ) {
      new Setting(containerEl)
        .setName("Custom AI model ID")
        .setDesc(
          "Used when 'Other (custom)' is selected above. Format: provider/model.",
        )
        .addText((text) => {
          text
            .setPlaceholder("google/gemini-2.5-flash-lite")
            .setValue(this.plugin.settings.aiCustomModelId)
            .onChange(async (value) => {
              this.plugin.settings.aiCustomModelId = value.trim();
              this.plugin.settings.aiModelId =
                value.trim() || "google/gemini-2.5-flash-lite";
              await this.plugin.saveSettings();
            });
          text.inputEl.style.width = "100%";
        });
    }

    new Setting(containerEl)
      .setName("AI request timeout (ms)")
      .setDesc("Maximum wait time for Ask AI requests before timing out.")
      .addText((text) => {
        text
          .setPlaceholder("45000")
          .setValue(String(this.plugin.settings.aiTimeoutMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value.trim(), 10);
            this.plugin.settings.aiTimeoutMs =
              Number.isFinite(parsed) && parsed >= 5000 ? parsed : 45000;
            await this.plugin.saveSettings();
          });
        text.inputEl.inputMode = "numeric";
      });

    new Setting(containerEl)
      .setName("Recipe title filler words")
      .setDesc(
        "Choose how recipe-title cleanup words are applied during imports.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", "Auto (built-in list)");
        dropdown.addOption("custom", "Custom list");
        dropdown.setValue(this.plugin.settings.fillerWordsMode || "auto");
        dropdown.onChange(async (value: "auto" | "custom") => {
          this.plugin.settings.fillerWordsMode = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.fillerWordsMode === "custom") {
      new Setting(containerEl)
        .setName("Custom filler words")
        .setDesc(
          "Words/phrases to remove from imported recipe titles. Separate with commas or new lines.",
        )
        .addTextArea((text) => {
          text
            .setPlaceholder("best, easy, one-pot")
            .setValue(this.plugin.settings.customFillerWords)
            .onChange(async (value) => {
              this.plugin.settings.customFillerWords = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.style.width = "100%";
          text.inputEl.style.minHeight = "90px";
        });
    }

    new Setting(containerEl)
      .setName("Filter vegan words")
      .setDesc(
        "When cleaning imported recipe titles, remove vegan-related words.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.filterVeganWords)
          .onChange(async (value) => {
            this.plugin.settings.filterVeganWords = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Filter gluten-free words")
      .setDesc(
        "When cleaning imported recipe titles, remove gluten-free-related words.",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.filterGlutenFreeWords)
          .onChange(async (value) => {
            this.plugin.settings.filterGlutenFreeWords = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Just adds some things to make dev life a little easier.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
