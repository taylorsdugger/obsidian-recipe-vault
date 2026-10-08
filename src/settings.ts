import {
  App,
  FuzzySuggestModal,
  getLanguage,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  SettingDefinitionItem,
  TextAreaComponent,
  TextComponent,
  TFile,
  TFolder,
} from "obsidian";
import {
  DEFAULT_AI_MODEL,
  primaryLanguage,
  TITLE_WORD_LISTS,
} from "@recipe-vault/core";
import RecipeVault from "./main";
import * as c from "./constants";

export interface PluginSettings {
  /**
   * How a recipe looks on a phone. Classic is the one scrolling page.
   * Kitchen splits it into Ingredients and Steps with a bar at the bottom.
   */
  mobileRecipeLayout: "classic" | "kitchen";
  /**
   * Start a recipe's properties folded away. Nutrition adds seven of them,
   * which pushed the recipe itself down the page.
   */
  collapseRecipeProperties: boolean;
  /**
   * Calories and macros: the line under At a Glance, nutrition properties on
   * import, and the commands that fetch them. Off unless someone wants it.
   */
  showNutrition: boolean;
  /** The Cook button on a recipe. Start cook mode still works without it. */
  showCookButton: boolean;
  folder: string;
  /** What new recipes are saved as. Existing files stay in their format. */
  recipeFormat: "markdown" | "cooklang";
  saveInActiveFile: boolean;
  imgFolder: string;
  saveImg: boolean;
  saveImgSubdir: boolean;
  recipeTemplate: string;
  /** A vault note to use as the template instead of `recipeTemplate`. */
  recipeTemplateFile: string;
  /** The front matter property a note keeps its photo under. */
  photoProperty: string;
  decodeEntities: boolean;
  proxyFallback: boolean;
  debug: boolean;
  shoppingListFile: string;
  recipeGalleryFolder: string;
  /** Off hides Ask AI, Add recipe from photo, and the AI settings. */
  aiFeatures: boolean;
  openRouterApiKey: string;
  aiModelPreset: string;
  aiCustomModelId: string;
  aiModelId: string;
  aiTimeoutMs: number;
  aiSystemPrompt: string;
  /** Strip the built-in filler words for the recipe's language. */
  useBuiltInFillerWords: boolean;
  /** The user's own title words to strip, in any language. */
  extraFillerWords: string;
  /** Built-in title words the user wants left alone. */
  keptFillerWords: string;
  filterVeganWords: boolean;
  filterGlutenFreeWords: boolean;
  /**
   * The language to clean titles in when the page doesn't say. Blank follows
   * Obsidian's own language.
   */
  recipeLanguage: string;
}

// Shared with the web app, which falls back to the same model.
export { DEFAULT_AI_MODEL };

const AI_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: DEFAULT_AI_MODEL, label: "Gemini 3.5 Flash Lite ($)" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini ($)" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 ($)" },
  { id: "minimax/minimax-m3", label: "MiniMax: MiniMax M3 ($)" },
];

/** Old preset ids, mapped to the preset that replaced them. */
export const LEGACY_AI_MODEL_PRESETS: Record<string, string> = {
  "google/gemini-2.5-flash-lite": DEFAULT_AI_MODEL,
  "openai/gpt-4.1-mini": "openai/gpt-5.4-mini",
  "anthropic/claude-3.5-haiku": "anthropic/claude-haiku-4.5",
  "minimax/minimax-m2.5": "minimax/minimax-m3",
};

const AI_MODEL_OTHER = "__other__";

export const DEFAULT_SETTINGS: PluginSettings = {
  mobileRecipeLayout: "classic",
  collapseRecipeProperties: true,
  showNutrition: false,
  showCookButton: true,
  folder: "Recipes",
  recipeFormat: "markdown",
  saveInActiveFile: false,
  imgFolder: "",
  saveImg: false,
  saveImgSubdir: false,
  recipeTemplate: c.DEFAULT_TEMPLATE,
  recipeTemplateFile: "",
  photoProperty: "photo",
  decodeEntities: true,
  proxyFallback: false,
  debug: false,
  shoppingListFile: "Shopping List.md",
  recipeGalleryFolder: "",
  aiFeatures: true,
  openRouterApiKey: "",
  aiModelPreset: DEFAULT_AI_MODEL,
  aiCustomModelId: "",
  aiModelId: DEFAULT_AI_MODEL,
  aiTimeoutMs: 45000,
  aiSystemPrompt: "",
  useBuiltInFillerWords: true,
  extraFillerWords: "",
  keptFillerWords: "",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
  recipeLanguage: "",
};

/** The old filler word settings, from when you got one list or the other. */
interface LegacyFillerWordSettings {
  fillerWordsMode?: "auto" | "custom";
  customFillerWords?: string;
}

/**
 * Filler words used to be a dropdown: the built-in list, or a custom list
 * instead of it (#33). A custom list carries over as extra words with the
 * built-in list off, so titles come out the same as before. Returns whether
 * anything changed and needs saving.
 */
export function migrateFillerWordSettings(
  s: PluginSettings & LegacyFillerWordSettings,
): boolean {
  if (s.fillerWordsMode === undefined && s.customFillerWords === undefined) {
    return false;
  }
  if (s.fillerWordsMode === "custom") {
    s.useBuiltInFillerWords = false;
    s.extraFillerWords = s.customFillerWords ?? "";
  }
  delete s.fillerWordsMode;
  delete s.customFillerWords;
  return true;
}

/**
 * Obsidian's interface language as a two-letter code, e.g. "de". Older
 * versions without getLanguage() get English, and can pick a language in
 * settings instead.
 */
export function obsidianLanguage(): string {
  if (requireApiVersion("1.8.7")) {
    return primaryLanguage(getLanguage()) ?? "en";
  }
  return "en";
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private readonly onChoose: (path: string) => void;

  constructor(app: App, onChoose: (path: string) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  getItems(): TFolder[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .sort((a: TFolder, b: TFolder) => a.path.localeCompare(b.path));
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder.path);
  }
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (path: string) => void;

  constructor(app: App, onChoose: (path: string) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  getItems(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file.path);
  }
}

/**
 * One row of the settings tab. `getSettingDefinitions()` hands these to
 * Obsidian 1.13+ so they show up in settings search, and `display()` renders
 * the same rows by hand on older versions.
 */
interface SettingRow {
  name: string;
  desc?: string | DocumentFragment;
  cls?: string;
  visible?: () => boolean;
  render: (setting: Setting) => void;
}

export class SettingsTab extends PluginSettingTab {
  plugin: RecipeVault;

  constructor(app: App, plugin: RecipeVault) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.containerEl.addClass("settingsTemplate");
    return this.rows().map((row) => ({
      name: row.name,
      desc: row.desc,
      visible: row.visible,
      render: (setting: Setting) => {
        if (row.cls) setting.setClass(row.cls);
        row.render(setting);
      },
    }));
  }

  /** Fallback for Obsidian before 1.13, which never calls the definitions. */
  display(): void {
    this.renderLegacy();
  }

  private renderLegacy(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("settingsTemplate");

    for (const row of this.rows()) {
      if (row.visible && !row.visible()) continue;
      const setting = new Setting(containerEl).setName(row.name);
      if (row.desc) setting.setDesc(row.desc);
      if (row.cls) setting.setClass(row.cls);
      row.render(setting);
    }
  }

  /** Re-check `visible` after a change that shows or hides other rows. */
  private refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.refreshDomState();
    } else {
      this.renderLegacy();
    }
  }

  private usesCustomModel(): boolean {
    const preset = this.plugin.settings.aiModelPreset;
    return (
      preset === AI_MODEL_OTHER ||
      !AI_MODEL_PRESETS.some((p) => p.id === preset)
    );
  }

  /** Built fresh each call, since a fragment empties out once it's rendered. */
  private rows(): SettingRow[] {
    const saveImgDescription = createFragment();
    saveImgDescription.append(
      "Save images imported by recipes. If empty, will follow: Files and links > new attachment location. See ",
      saveImgDescription.createEl("a", {
        href: "https://github.com/taylorsdugger/obsidian-recipe-vault#settings",
        text: "README",
      }),
      " for more info.",
    );

    const templateFileDescription = createFragment();
    templateFileDescription.append(
      "A note in your vault to use as the template for new recipes. Leave it blank to use the template below. Create makes one from the template below. Keep it outside your recipe folder. See ",
      templateFileDescription.createEl("a", {
        href: "https://github.com/taylorsdugger/obsidian-recipe-vault#custom-templates",
        text: "README",
      }),
      " for more info.",
    );

    const templateDescription = createFragment();
    templateDescription.append(
      "The template for new recipes when no template file is set. See ",
      templateDescription.createEl("a", {
        href: "https://github.com/taylorsdugger/obsidian-recipe-vault#custom-templates",
        text: "README",
      }),
      " for more info.",
    );

    return [
      {
        name: "Recipe layout on small screens",
        desc: "Classic is the recipe as one scrolling page. Kitchen splits it into Ingredients and Steps tabs, with bigger rows to tap and a bar at the bottom for adding to your list. Kitchen is used on phones and tablets, and on desktop when a recipe's pane is narrower than about 640px. On a wide pane the ingredients always sit in a column beside the steps.",
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOption("classic", "Classic");
            dropdown.addOption("kitchen", "Kitchen");
            dropdown.setValue(this.plugin.settings.mobileRecipeLayout);
            dropdown.onChange(async (value) => {
              this.plugin.settings.mobileRecipeLayout =
                value === "kitchen" ? "kitchen" : "classic";
              await this.plugin.saveSettings();
              this.plugin.applyRecipeLayoutSetting();
            });
          });
        },
      },
      {
        name: "Show nutrition",
        desc: "Calories, protein, carbs and fat for each serving, under At a Glance. New imports get them from the recipe page, and Fetch missing nutrition from source pages fills in recipes you already have. Off by default.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showNutrition)
              .onChange(async (value) => {
                this.plugin.settings.showNutrition = value;
                await this.plugin.saveSettings();
                this.plugin.applyNutritionSetting();
              });
          });
        },
      },
      {
        name: "Show Cook button",
        desc: "The Cook button on a recipe, which opens cook mode. Turn it off to hide it. The Start cook mode command still works.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showCookButton)
              .onChange(async (value) => {
                this.plugin.settings.showCookButton = value;
                await this.plugin.saveSettings();
                this.plugin.refreshRecipeActions();
              });
          });
        },
      },
      {
        name: "Collapse properties on recipes",
        desc: "Fold a recipe's properties away when you open it, so the recipe comes first. Click Properties to open them. They fold again the next time you open the recipe.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.collapseRecipeProperties)
              .onChange(async (value) => {
                this.plugin.settings.collapseRecipeProperties = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Recipe save folder",
        desc: "Default recipe import location. If empty, recipe will be imported in the Vault root.",
        render: (setting) => {
          let input: TextComponent;
          setting
            .addText((text) => {
              input = text;
              text
                .setPlaceholder("Recipes")
                .setValue(this.plugin.settings.folder)
                .onChange(async (value) => {
                  this.plugin.settings.folder = value.trim();
                  await this.plugin.saveSettings();
                });
            })
            .addButton((btn) =>
              btn.setButtonText("Browse").onClick(() => {
                new FolderSuggestModal(this.app, (path) => {
                  void (async () => {
                    this.plugin.settings.folder = path;
                    await this.plugin.saveSettings();
                    input.setValue(path);
                  })();
                }).open();
              }),
            );
        },
      },
      {
        name: "Save new recipes as",
        desc: "Markdown notes use the recipe template below. Cooklang saves a .cook file, with its photo in the image folder below, or next to the file if that's blank. Recipes you already have stay as they are, and the gallery shows both.",
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOption("markdown", "Markdown note");
            dropdown.addOption("cooklang", "Cooklang file");
            dropdown.setValue(this.plugin.settings.recipeFormat);
            dropdown.onChange(async (value) => {
              this.plugin.settings.recipeFormat =
                value === "cooklang" ? "cooklang" : "markdown";
              await this.plugin.saveSettings();
              this.refresh();
            });
          });
        },
      },
      {
        name: "Save in currently opened file",
        desc: "Imports the recipe into an active document. if no active document, the above save folder setting will apply.",
        // A .cook file can't go inside a markdown note.
        visible: () => this.plugin.settings.recipeFormat === "markdown",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.saveInActiveFile)
              .onChange(async (value) => {
                this.plugin.settings.saveInActiveFile = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Save images",
        desc: saveImgDescription,
        render: (setting) => {
          let input: TextComponent;
          setting
            .addText((text) => {
              input = text;
              text
                .setPlaceholder("Recipes/images")
                .setValue(this.plugin.settings.imgFolder)
                .onChange(async (value) => {
                  this.plugin.settings.imgFolder = value.trim();
                  await this.plugin.saveSettings();
                });
            })
            .addButton((btn) =>
              btn.setButtonText("Browse").onClick(() => {
                new FolderSuggestModal(this.app, (path) => {
                  void (async () => {
                    this.plugin.settings.imgFolder = path;
                    await this.plugin.saveSettings();
                    input.setValue(path);
                  })();
                }).open();
              }),
            )
            .addToggle((toggle) => {
              toggle
                .setValue(this.plugin.settings.saveImg)
                .onChange(async (value) => {
                  this.plugin.settings.saveImg = value;
                  await this.plugin.saveSettings();
                });
            });
        },
      },
      {
        name: "Save images in subdirectories",
        desc: "Create a subdirectory for each recipe to store images. A parent directory needs to be set above.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.saveImgSubdir)
              .onChange(async (value) => {
                this.plugin.settings.saveImgSubdir = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Template file",
        desc: templateFileDescription,
        visible: () => this.plugin.settings.recipeFormat === "markdown",
        render: (setting) => {
          let input: TextComponent;
          setting
            .addText((text) => {
              input = text;
              text
                .setPlaceholder("Templates/Recipe.md")
                .setValue(this.plugin.settings.recipeTemplateFile)
                .onChange(async (value) => {
                  this.plugin.settings.recipeTemplateFile = value.trim();
                  await this.plugin.saveSettings();
                });
            })
            .addButton((btn) =>
              btn.setButtonText("Browse").onClick(() => {
                new FileSuggestModal(this.app, (path) => {
                  void (async () => {
                    this.plugin.settings.recipeTemplateFile = path;
                    await this.plugin.saveSettings();
                    input.setValue(path);
                  })();
                }).open();
              }),
            )
            .addButton((btn) =>
              btn.setButtonText("Create").onClick(async () => {
                const path = await this.plugin.createTemplateFile();
                if (path) input.setValue(path);
              }),
            );
        },
      },
      {
        name: "Recipe template",
        desc: templateDescription,
        visible: () => this.plugin.settings.recipeFormat === "markdown",
        cls: "settingsTemplateRow",
        render: (setting) => {
          let area: TextAreaComponent;
          setting
            .addButton((btn) =>
              btn
                .setButtonText("Reset to default")
                .setClass("settingsTemplateButton")
                .setCta()
                .onClick(async () => {
                  this.plugin.settings.recipeTemplate = c.DEFAULT_TEMPLATE;
                  await this.plugin.saveSettings();
                  area.setValue(c.DEFAULT_TEMPLATE);
                }),
            )
            .addTextArea((text) => {
              area = text;
              text
                .setValue(this.plugin.settings.recipeTemplate)
                .onChange(async (value) => {
                  this.plugin.settings.recipeTemplate = value;
                  await this.plugin.saveSettings();
                });
            });
        },
      },
      {
        name: "Photo property",
        desc: "The front matter property that holds a recipe's photo. Match what your template writes, so new notes don't get a second photo property. Blank means photo. Notes that only have photo still show their photo.",
        render: (setting) => {
          setting.addText((text) => {
            text
              .setValue(this.plugin.settings.photoProperty)
              .onChange(async (value) => {
                this.plugin.settings.photoProperty = value.trim();
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Decode entities",
        desc: "We decode entities in the recipe to make it more readable in edit mode. If you don't want this, just turn it off here!",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.decodeEntities)
              .onChange(async (value) => {
                this.plugin.settings.decodeEntities = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Proxy fallback for blocked imports",
        desc: "If a recipe page blocks the import (e.g. a 403 from bot protection, most common on mobile), retry through public read proxies (jina.ai, then allorigins.win), with a few attempts each. This sends the recipe URL to a third-party service. Off by default.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.proxyFallback)
              .onChange(async (value) => {
                this.plugin.settings.proxyFallback = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Shopping list file",
        desc: "Path to the file where checked ingredients are sent when using 'Add checked ingredients to shopping list'. Include a folder path to auto-create it (eg: Lists/Shopping List.md). Will be created if it doesn't exist.",
        render: (setting) => {
          let input: TextComponent;
          setting
            .addText((text) => {
              input = text;
              text
                .setPlaceholder("eg: Shopping List.md")
                .setValue(this.plugin.settings.shoppingListFile)
                .onChange(async (value) => {
                  this.plugin.settings.shoppingListFile =
                    value.trim() || "Shopping List.md";
                  await this.plugin.saveSettings();
                });
            })
            .addButton((btn) =>
              btn.setButtonText("Browse").onClick(() => {
                new FileSuggestModal(this.app, (path) => {
                  void (async () => {
                    this.plugin.settings.shoppingListFile = path;
                    await this.plugin.saveSettings();
                    input.setValue(path);
                  })();
                }).open();
              }),
            );
        },
      },
      {
        name: "Recipe gallery folder",
        desc: "Folder to display in the Recipe Gallery panel, including its subfolders. Leave blank to follow the Recipe save folder above (recommended). Set a folder only if you want the gallery to browse somewhere other than where recipes are saved.",
        render: (setting) => {
          let input: TextComponent;
          setting
            .addText((text) => {
              input = text;
              text
                .setPlaceholder("Follows save folder")
                .setValue(this.plugin.settings.recipeGalleryFolder)
                .onChange(async (value) => {
                  this.plugin.settings.recipeGalleryFolder = value.trim();
                  await this.plugin.saveSettings();
                });
            })
            .addButton((btn) =>
              btn.setButtonText("Browse").onClick(() => {
                new FolderSuggestModal(this.app, (path) => {
                  void (async () => {
                    this.plugin.settings.recipeGalleryFolder = path;
                    await this.plugin.saveSettings();
                    input.setValue(path);
                  })();
                }).open();
              }),
            );
        },
      },
      {
        name: "AI features",
        desc: "Ask AI on recipe notes and Add recipe from photo. Turn this off to hide both, along with the AI settings below.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.aiFeatures)
              .onChange(async (value) => {
                this.plugin.settings.aiFeatures = value;
                await this.plugin.saveSettings();
                this.plugin.refreshRecipeActions();
                this.refresh();
              });
          });
        },
      },
      {
        name: "OpenRouter API key",
        desc: "Used for Ask AI recipe edits and Add recipe from photo. Stored in this vault config as plain text.",
        visible: () => this.plugin.settings.aiFeatures,
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("Starts with sk-or-v1-")
              .setValue(this.plugin.settings.openRouterApiKey)
              .onChange(async (value) => {
                this.plugin.settings.openRouterApiKey = value.trim();
                await this.plugin.saveSettings();
              });
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
            text.inputEl.addClass("recipe-vault-input-full");
          });
        },
      },
      {
        name: "AI model ID",
        desc: "Choose a default OpenRouter model for Ask AI. Prices are rough relative tiers.",
        visible: () => this.plugin.settings.aiFeatures,
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            AI_MODEL_PRESETS.forEach((preset) => {
              dropdown.addOption(preset.id, preset.label);
            });
            dropdown.addOption(AI_MODEL_OTHER, "Other (custom)");
            dropdown.setValue(
              this.usesCustomModel()
                ? AI_MODEL_OTHER
                : this.plugin.settings.aiModelPreset,
            );

            dropdown.onChange(async (value) => {
              this.plugin.settings.aiModelPreset = value;
              if (value !== AI_MODEL_OTHER) {
                this.plugin.settings.aiModelId = value;
              }
              await this.plugin.saveSettings();
              this.refresh();
            });
          });
        },
      },
      {
        name: "Custom AI model ID",
        desc: "Used when 'Other (custom)' is selected above. Format: provider/model.",
        visible: () =>
          this.plugin.settings.aiFeatures && this.usesCustomModel(),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("Provider/model")
              .setValue(this.plugin.settings.aiCustomModelId)
              .onChange(async (value) => {
                this.plugin.settings.aiCustomModelId = value.trim();
                this.plugin.settings.aiModelId =
                  value.trim() || DEFAULT_AI_MODEL;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("recipe-vault-input-full");
          });
        },
      },
      {
        name: "AI request timeout (ms)",
        visible: () => this.plugin.settings.aiFeatures,
        desc: "Maximum wait time for Ask AI requests before timing out.",
        render: (setting) => {
          setting.addText((text) => {
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
        },
      },
      {
        name: "Custom AI system prompt",
        visible: () => this.plugin.settings.aiFeatures,
        desc: "Override the default AI instructions sent with every request. Leave blank to use the built-in default.",
        render: (setting) => {
          setting.addTextArea((text) => {
            text
              .setPlaceholder(
                "Always suggest substitutions that are dairy-free.",
              )
              .setValue(this.plugin.settings.aiSystemPrompt)
              .onChange(async (value) => {
                this.plugin.settings.aiSystemPrompt = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("recipe-vault-input-full");
            text.inputEl.addClass("recipe-vault-textarea-ai-prompt");
          });
        },
      },
      {
        name: "Remove filler words from titles",
        desc: 'Strip words like "easy" and "best" from imported recipe titles. The list matches the recipe\'s language.',
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.useBuiltInFillerWords)
              .onChange(async (value) => {
                this.plugin.settings.useBuiltInFillerWords = value;
                await this.plugin.saveSettings();
                this.refresh();
              });
          });
        },
      },
      {
        name: "Filler words to keep",
        desc: "Built-in words to leave in titles. Separate with commas or new lines.",
        visible: () => this.plugin.settings.useBuiltInFillerWords,
        render: (setting) => {
          setting.addTextArea((text) => {
            text
              .setPlaceholder("Classic, crispy")
              .setValue(this.plugin.settings.keptFillerWords)
              .onChange(async (value) => {
                this.plugin.settings.keptFillerWords = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("recipe-vault-input-full");
            text.inputEl.addClass("recipe-vault-textarea-filler-words");
          });
        },
      },
      {
        name: "Extra filler words",
        desc: "Your own words to remove from imported titles, in any language. Separate with commas or new lines.",
        render: (setting) => {
          setting.addTextArea((text) => {
            text
              .setPlaceholder("Spicy, viral")
              .setValue(this.plugin.settings.extraFillerWords)
              .onChange(async (value) => {
                this.plugin.settings.extraFillerWords = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("recipe-vault-input-full");
            text.inputEl.addClass("recipe-vault-textarea-filler-words");
          });
        },
      },
      {
        name: "Filter vegan words",
        desc: "When cleaning imported recipe titles, remove vegan-related words.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.filterVeganWords)
              .onChange(async (value) => {
                this.plugin.settings.filterVeganWords = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Filter gluten-free words",
        desc: "When cleaning imported recipe titles, remove gluten-free-related words.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.filterGlutenFreeWords)
              .onChange(async (value) => {
                this.plugin.settings.filterGlutenFreeWords = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Recipe language",
        desc: "Which word lists to use when a recipe page doesn't say what language it's in. Most pages do.",
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            const obsidian = obsidianLanguage();
            const obsidianName = TITLE_WORD_LISTS[obsidian]?.name ?? obsidian;
            dropdown.addOption("", `Match Obsidian (${obsidianName})`);
            for (const [code, list] of Object.entries(TITLE_WORD_LISTS)) {
              dropdown.addOption(code, list.name);
            }
            dropdown.setValue(this.plugin.settings.recipeLanguage);
            dropdown.onChange(async (value) => {
              this.plugin.settings.recipeLanguage = value;
              await this.plugin.saveSettings();
            });
          });
        },
      },
      {
        name: "Debug mode",
        desc: "Just adds some things to make dev life a little easier.",
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.debug)
              .onChange(async (value) => {
                this.plugin.settings.debug = value;
                await this.plugin.saveSettings();
              });
          });
        },
      },
    ];
  }
}
