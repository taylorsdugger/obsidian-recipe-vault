import {
  App,
  FuzzySuggestModal,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  SettingDefinitionItem,
  TextAreaComponent,
  TextComponent,
  TFile,
  TFolder,
} from "obsidian";
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
  proxyFallback: boolean;
  debug: boolean;
  shoppingListFile: string;
  recipeGalleryFolder: string;
  openRouterApiKey: string;
  aiModelPreset: string;
  aiCustomModelId: string;
  aiModelId: string;
  aiTimeoutMs: number;
  aiSystemPrompt: string;
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
  folder: "Recipes",
  saveInActiveFile: false,
  imgFolder: "",
  saveImg: false,
  saveImgSubdir: false,
  recipeTemplate: c.DEFAULT_TEMPLATE,
  templateVersion: c.TEMPLATE_VERSION,
  decodeEntities: true,
  proxyFallback: false,
  debug: false,
  shoppingListFile: "Shopping List.md",
  recipeGalleryFolder: "",
  openRouterApiKey: "",
  aiModelPreset: "google/gemini-2.5-flash-lite",
  aiCustomModelId: "",
  aiModelId: "google/gemini-2.5-flash-lite",
  aiTimeoutMs: 45000,
  aiSystemPrompt: "",
  fillerWordsMode: "auto",
  customFillerWords: "",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
};

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

    const templateDescription = createFragment();
    templateDescription.append(
      "Here you can edit the Template for newly created files. See ",
      templateDescription.createEl("a", {
        href: "https://github.com/taylorsdugger/obsidian-recipe-vault#custom-templates",
        text: "README",
      }),
      " for more info.",
    );

    return [
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
        name: "Save in currently opened file",
        desc: "Imports the recipe into an active document. if no active document, the above save folder setting will apply.",
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
        name: "Recipe template",
        desc: templateDescription,
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
        name: "OpenRouter API key",
        desc: "Used for Ask AI recipe edits and Add recipe from photo. Stored in this vault config as plain text.",
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
        visible: () => this.usesCustomModel(),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("Provider/model")
              .setValue(this.plugin.settings.aiCustomModelId)
              .onChange(async (value) => {
                this.plugin.settings.aiCustomModelId = value.trim();
                this.plugin.settings.aiModelId =
                  value.trim() || "google/gemini-2.5-flash-lite";
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("recipe-vault-input-full");
          });
        },
      },
      {
        name: "AI request timeout (ms)",
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
        name: "Recipe title filler words",
        desc: "Choose how recipe-title cleanup words are applied during imports.",
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOption("auto", "Auto (built-in list)");
            dropdown.addOption("custom", "Custom list");
            dropdown.setValue(this.plugin.settings.fillerWordsMode || "auto");
            dropdown.onChange(async (value) => {
              this.plugin.settings.fillerWordsMode =
                value === "custom" ? "custom" : "auto";
              await this.plugin.saveSettings();
              this.refresh();
            });
          });
        },
      },
      {
        name: "Custom filler words",
        desc: "Words/phrases to remove from imported recipe titles. Separate with commas or new lines.",
        visible: () => this.plugin.settings.fillerWordsMode === "custom",
        render: (setting) => {
          setting.addTextArea((text) => {
            text
              .setPlaceholder("Best, easy, one-pot")
              .setValue(this.plugin.settings.customFillerWords)
              .onChange(async (value) => {
                this.plugin.settings.customFillerWords = value;
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
