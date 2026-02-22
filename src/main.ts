/**
 * This is the main file for the recipe-grabber plugin. The summary is:
 * - fetch a recipe from a url
 * - if the recipe is valid, try and normalize it into a simple templatable format
 * - render the recipe into a markdown template
 * - add the recipe to the markdown editor
 */

import {
  MarkdownView,
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
import { fileTypeFromBuffer } from "file-type";
import * as c from "./constants";
import * as settings from "./settings";
import { LoadRecipeModal } from "./modal-load-recipe";
import dateFormat from "dateformat";

interface ShoppingItem {
  checked: boolean;
  amount: number;
  unit: string;
  name: string;
  sources: string[];
  original: string;
}

export default class RecipeGrabber extends Plugin {
  settings: settings.PluginSettings;

  async onload() {
    await this.loadSettings();
    // This creates an icon in the left ribbon.
    this.addRibbonIcon("chef-hat", this.manifest.name, (evt: MouseEvent) => {
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
      name: "Grab Recipe",
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

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new settings.SettingsTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign(
      {},
      settings.DEFAULT_SETTINGS,
      await this.loadData(),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
          "Content-Type": "text/html",
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
      const json = JSON.parse(content);

      // to make things consistent, we'll put all recipes into an array
      const data = Array.isArray(json) ? json : [json];
      handleSchemas(data);
    });

    return recipes;
  }

  /**
   * This function handles all the templating of the recipes
   */
  private addRecipeToMarkdown = async (url: string): Promise<void> => {
    // Add a handlebar function to split comma separated tags into the obsidian expected array/list
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

    // quick function to check if a string is a valid date
    function isValidDate(d: string): boolean {
      return !isNaN(Date.parse(d));
    }

    handlebars.registerHelper("magicTime", function (arg1, arg2) {
      if (typeof arg1 === "undefined") {
        // catch undefined / empty
        return "";
      }
      // Handlebars appends an ubject to the arguments
      if (arguments.length === 1) {
        // magicTime
        return dateFormat(new Date(), "yyyy-mm-dd HH:MM");
      } else if (arguments.length === 2) {
        // check if arg1 is a valid date
        if (isValidDate(arg1)) {
          // magicTime datePublished
          return dateFormat(new Date(arg1), "yyyy-mm-dd HH:MM");
        }
        if (arg1.trim().startsWith("PT")) {
          // magicTime PT1H50M
          return arg1
            .trim()
            .replace("PT", "")
            .replace("H", "h ")
            .replace("M", "m ")
            .replace("S", "s ");
        }
        try {
          // magicTime "dd-mm-yyyy HH:MM"
          return dateFormat(new Date(), arg1);
        } catch (error) {
          return "";
        }
      } else if (arguments.length === 3) {
        // magicTime datePublished "dd-mm-yyyy HH:MM"
        if (isValidDate(arg1)) {
          return dateFormat(new Date(arg1), arg2);
        }
        // Invalid input
        return "Error in template or source";
      } else {
        // Unexpected amount of arguments
        return "Error in template";
      }
    });

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
            return;
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

        if (view.getMode() === "source") {
          view.editor.replaceSelection(md);
        } else {
          await this.app.vault.append(view.file, md);
        }
      }
    } catch (error) {
      if (this.settings.debug) {
        console.error(error);
      }
      return;
    }
  };

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

    const fillerWords = [
      // Dietary labels (checked before shorter tokens)
      "gluten[- ]?free",
      "dairy[- ]?free",
      "plant[- ]?based",
      "guilt[- ]?free",
      "lightened[- ]?up",
      "vegetarian",
      "vegan",
      "paleo",
      "whole30",
      "keto",
      "gf",
      "df",
      // Marketing / filler words
      "the\\s+ultimate",
      "the\\s+best",
      "ultimate",
      "incredible",
      "delicious",
      "homemade",
      "awesome",
      "classic",
      "perfect",
      "amazing",
      "lighter",
      "skinny",
      "simple",
      "tasty",
      "great",
      "quick",
      "super",
      "easy",
      "best",
      "healthy",
    ];

    let cleaned = name;
    for (const word of fillerWords) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      cleaned = cleaned.replace(regex, "");
    }

    // Tidy up leftover punctuation, symbols, and whitespace
    cleaned = cleaned.replace(/[\s,\-–—&|]+/g, " ").trim();

    // Fall back to the original name if stripping removed everything
    return cleaned || name;
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
      const type = await fileTypeFromBuffer(res.arrayBuffer); // type of the image
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
