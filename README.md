<div align="center">

# 🥘 Recipe Vault

**Your recipes, in plain markdown or Cooklang, right inside Obsidian.**

<a href="https://recipes.taylordugger.com"><img alt="Website" src="https://img.shields.io/badge/website-recipes.taylordugger.com-7c3aed?logo=safari&logoColor=white"></a>
<a href="https://github.com/taylorsdugger/obsidian-recipe-vault/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/taylorsdugger/obsidian-recipe-vault?logo=obsidian&color=7c3aed"></a>
<img alt="Downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&query=%24%5B%22recipe-vault%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&label=downloads">
<a href="https://github.com/taylorsdugger/obsidian-recipe-vault/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/taylorsdugger/obsidian-recipe-vault?color=blue"></a>

<br/>

**[🌐 Visit the site](https://recipes.taylordugger.com)** &nbsp;·&nbsp; **[📦 Install from the community directory](https://community.obsidian.md/plugins/recipe-vault)**

<br/>

<img src="docs/panels/1-gallery.png" alt="Your whole cookbook, at a glance: every recipe becomes a visual card you can filter by tag and sort, on desktop and mobile">

</div>

---

Import recipes from the web, browse them in a visual gallery, and build shopping lists automatically. Paste a URL, get a clean recipe note, or a [Cooklang](https://cooklang.org) file if you'd rather. No subscriptions, no accounts, no ads. Just your recipes in your vault.

Screenshots and a walkthrough of every feature: **[recipes.taylordugger.com](https://recipes.taylordugger.com)**.

---

## ✨ Features

- 🌐 **Import from any URL:** fetches structured recipe data (JSON-LD) from a recipe page and creates a formatted note instantly.
- 📸 **Add recipe from photo:** photograph a cookbook page or recipe card (or pick image files) and let AI vision transcribe it into a recipe note, with a verify/edit step before saving. Works on desktop and mobile.
- ✍️ **Add recipes manually:** create a recipe note from scratch using the same template.
- 🍳 **Cooklang support:** open `.cook` files in a recipe view, or have every new recipe saved as Cooklang instead of markdown. The gallery, search and shopping list work with both. See [Cooklang](#-cooklang).
- 📦 **Import and export files:** turn JSON-LD (`.json`) and Cooklang (`.cook`) files into recipes one at a time or a whole folder at once, and export any recipe back out as either.
- 🖼️ **Recipe gallery:** browse your whole collection visually in a dedicated gallery view, markdown notes and `.cook` files together.
- 🔍 **Search everything:** filter as you type across titles, meal types, _and_ ingredients, so you can find every recipe that uses what's already in the fridge.
- ⚖️ **Shopping list:** check off ingredients in a recipe and send them to a single shopping list file. Duplicates combine even when the recipes wrote them differently - "1 large onion" and "2 yellow onions, diced" come out as one row of three - and the list is sorted by aisle, so the produce is together.
- 🔁 **Compare recipes:** select multiple recipes and view them side by side, with shared and unique ingredients highlighted.
- 📅 **Mark as made:** track when you last made a recipe and how many times.
- 🤖 **Ask AI for edits:** request changes like "make this dairy-free" or "scale to 2 servings" via OpenRouter (API key required). Markdown notes only for now.
- 🎨 **Customizable templates:** full Handlebars support so your notes look exactly how you want.

<div align="center">

<img src="docs/panels/2-recipe-note.png" alt="A clean recipe, in plain markdown: each recipe is an ordinary note with a hero photo, ingredients, and one-tap actions">

<br/>

<img src="docs/panels/4-shopping-list.png" alt="One tap to your shopping list: ingredients go to a running list that remembers which dish each item came from">

</div>

---

## 📥 Installation

### From the Obsidian Community Plugins browser

1. Open Obsidian → **Settings** → **Community plugins**
2. Search for **Recipe Vault**
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/taylorsdugger/obsidian-recipe-vault/releases/latest).
2. Copy them into your vault at `.obsidian/plugins/recipe-vault/`.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

---

## 🚀 Quick Start

1. Click the **chef hat icon** in the ribbon (or run **Import recipe** from the command palette).
2. Paste a recipe URL and press Enter.
3. Your recipe note is created in the configured save folder. If **Save new recipes as** is set to Cooklang, you get a `.cook` file instead.

To browse your recipes, click the **utensils icon** in the ribbon to open the Recipe Gallery.

<div align="center">

<img src="docs/panels/5-import.png" alt="Paste a link, get a recipe: drop in any recipe URL and Recipe Vault saves a clean, ad-free note to your vault">

</div>

---

## ⌨️ Commands

| Command                                         | What it does                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Import recipe**                               | Opens a URL prompt and imports a recipe into a new note (or `.cook` file)                                        |
| **Open recipe gallery**                         | Opens the visual gallery of your recipes                                                                         |
| **Mark recipe as made**                         | Adds one to the times made and sets the last made date to today on the active recipe                             |
| **Add checked ingredients to shopping list**    | Sends checked ingredients from the active recipe to your shopping list file                                      |
| **Clear checked items from shopping list**      | Removes completed items from your shopping list                                                                  |
| **Add recipe (manual)**                         | Creates a new recipe from a title prompt                                                                         |
| **Add recipe from photo**                       | Transcribes a photographed cookbook page or recipe card into a new recipe (requires an OpenRouter API key)       |
| **Batch import recipes from URL list**          | Imports multiple recipes from a list of URLs (one per line) in the active note                                   |
| **Import recipe from JSON-LD or Cooklang file** | Pick a `.json` or `.cook` file in your vault and make a recipe from it                                           |
| **Import recipes from folder**                  | Makes a recipe from every `.json` and `.cook` file in a folder. Also on a folder's right-click menu              |
| **Export recipe as JSON-LD file**               | Writes the active recipe out as a `.json` file next to it. Works on notes and `.cook` files                      |
| **Export recipe as Cooklang file**              | Writes the active recipe note out as a `.cook` file next to it                                                   |
| **Rebuild ingredient search index**             | Rebuilds the index that powers ingredient search in the gallery                                                  |

---

## ⚙️ Settings

| Setting                                    | Description                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recipe save folder**                     | Where new recipes are created. The gallery browses this folder by default, so imports show up automatically                                                                  |
| **Save new recipes as**                    | **Markdown note** (default) or **Cooklang file**. Applies to every import and to Add recipe (manual). Recipes you already have stay as they are                              |
| **Save in currently opened file**          | Import into the active note instead of creating a new one. Markdown only                                                                                                     |
| **Save images**                            | Download recipe images into your vault, into this folder. Leave the folder blank to use Obsidian's attachment location, or for a `.cook` file, to put the photo next to it   |
| **Save images in subdirectories**          | Create a per-recipe subfolder under the image folder                                                                                                                         |
| **Template file**                          | A note in your vault to use as the template instead of the one below. **Create** writes the current template out to a new note. Markdown only. See [Custom Templates](#-custom-templates) |
| **Recipe template**                        | Handlebars template used when creating recipe notes, when no template file is set. Markdown only                                                                             |
| **Photo property**                         | The frontmatter property that holds a recipe's photo (default `photo`). Set it to match your template, e.g. `image_url`, and the gallery reads that instead               |
| **Decode entities**                        | Decodes HTML entities in imported data                                                                                                                                       |
| **Proxy fallback for blocked imports**     | If a page blocks the import (e.g. a 403 from bot protection), retry once through a public read proxy (allorigins.win). Sends the recipe URL to a third party. Off by default |
| **Shopping list file**                     | Path to your shopping list note (created automatically if missing)                                                                                                           |
| **Recipe gallery folder**                  | The folder the Recipe Gallery browses, including its subfolders. **Leave blank to follow the Recipe save folder** (recommended). Set it only to browse a different folder    |
| **OpenRouter API key**                     | Required for Ask AI and Add recipe from photo                                                                                                                                |
| **AI model ID**                            | Which model to use for Ask AI and Add recipe from photo (default: `google/gemini-2.5-flash-lite`)                                                                            |
| **AI request timeout (ms)**                | Timeout for AI requests (minimum 5000 ms)                                                                                                                                    |
| **Custom AI system prompt**                | Optional override for the built-in Ask AI instructions                                                                                                                       |
| **Recipe title filler words**              | Controls how imported titles are cleaned up                                                                                                                                  |
| **Filter vegan words / gluten-free words** | Optionally strips dietary labels from imported recipe titles                                                                                                                 |
| **Debug mode**                             | Enables extra developer logging                                                                                                                                              |

> **Gallery is empty but you've imported recipes?** By default the gallery follows your **Recipe save folder**, so this shouldn't happen. If it does, you've set an explicit **Recipe gallery folder** that points somewhere other than where recipes are saved. Either clear that setting (blank = follow the save folder) or point it at your save folder, and your recipes will show up.

---

## 📝 Custom Templates

Recipe Vault uses [Handlebars](https://handlebarsjs.com/guide/#simple-expressions) for note templates. The plugin assumes the recipe page includes [JSON-LD structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe).

### Template file

You can edit the template in settings, or keep it as a note in your vault and point **Template file** at it. A file is easier to edit, it syncs with the rest of your vault, and the plugin never overwrites it.

To start one, click **Create** next to **Template file**. That writes your current template to `Recipe Vault template.md` in the vault root and selects it. You can move or rename it after, just update the setting. If the file goes missing, new recipes use the template in settings and you get a notice.

Some things to know:

- Keep it outside your recipe folder. The plugin skips the template file itself, but other plugins that list your recipes won't know to.
- Obsidian may flag the `{{...}}` values in the template's own properties as invalid. That only affects the template note, not the recipes made from it.
- If your template keeps the photo under a different property, like `image_url`, set **Photo property** to match. Otherwise the plugin adds a `photo` property to every new note so the gallery can find the image.

### Built-in helpers

**`splitTags`** converts comma-separated tags into a YAML list for Obsidian frontmatter:

```handlebars
tags:
{{splitTags keywords}}
```

**`photoFrontmatter`** formats image values correctly for frontmatter (wikilink for local files, URL for remote):

```handlebars
photo: "{{photoFrontmatter image}}"
```

**`magicTime`** formats ISO durations and timestamps into readable values:

```handlebars
DateSaved:
{{magicTime}}
CookTime:
{{magicTime cookTime}}
TotalTime:
{{magicTime totalTime}}
DatePublished:
{{magicTime datePublished "dd-mm-yyyy"}}
```

Example output:

```
DateSaved: 2024-04-13 20:10
CookTime: 15m
TotalTime: 1h 5m
```

### Default frontmatter fields

```yaml
cssclasses: recipe-note
tags:
date_added:
meal_type:
author:
cook_time:
url:
photo:
times_made:
last_made:
```

If your template leaves out `cssclasses`, `cook_time` or the photo property, the plugin adds them to new notes. The gallery needs them. Your template itself is never changed.

> **Tip:** Keep frontmatter starting at line 1 of your template. Obsidian requires this to parse it correctly.

---

## 🍳 Cooklang

[Cooklang](https://cooklang.org) is a plain-text recipe format. Instead of a separate ingredient list, ingredients are marked right in the steps:

```
---
title: Leek Soup
servings: 4
time: 45m
---

Melt @butter{2%tbsp} in a #large pot{} and soften @leeks{3}(sliced) for ~{10%minutes}.

Add @stock{1%l} and simmer for ~{20%minutes}.
```

### Opening .cook files

Recipe Vault opens `.cook` files in their own view, laid out like a recipe note: an "At a Glance" box, the ingredients as a checkbox list, cookware, and the steps with ingredients, cookware and timers picked out. Your theme styles it the same as your notes.

- **Mark as made** and **Add checked to shopping list** work from the view, the same as from a note. Times made is saved in the file as `times made` and `last made`.
- **Edit** switches to a plain text editor over the file. The pencil in the view's header does the same.
- The photo at the top is the one named after the recipe and sitting next to it (`Leek Soup.jpg` beside `Leek Soup.cook`), which is where Cooklang keeps photos. Failing that, it's whatever the file's `image:` points at, a path in your vault or a URL.
- Another recipe used as an ingredient, like `@./Sauces/Hollandaise{150%g}`, is a link you can click. It's looked for next to the file, then in your recipe folder, then anywhere in the vault by name.
- Ticked ingredients reset when you close the file, since a `.cook` file has nowhere to keep them.

If you also have the Cooklang plugin installed, whichever plugin loads first opens `.cook` files. Recipe Vault leaves them alone if another plugin already has them.

### Saving new recipes as Cooklang

Set **Save new recipes as** to **Cooklang file** and every new recipe is saved as a `.cook` file: URL imports, batch imports, photo imports, file and folder imports, and Add recipe (manual). Switch it back to Markdown and new recipes are notes again. Nothing you already have gets converted either way, and the gallery shows both.

Recipe pages keep the ingredients apart from the steps, and Cooklang marks them inside the steps, so an import has to match them up. Each ingredient is marked in the first step that mentions it. "1 yellow onion, diced" matches a step that says "the onions" and becomes `@yellow onion{1}(diced)`. An ingredient no step mentions goes in a "Gather" step at the top so nothing is lost.

The photo goes in your image folder (see **Save images**) and the file's `image:` points at it. If the image folder is blank, it goes next to the file as `Recipe Name.jpg` instead.

Importing a `.cook` file while in Cooklang mode copies it as written, so its cookware and timers come along.

### The gallery

`.cook` files show up in the gallery next to your notes, with their photo, meal type (`course`), cook time (`time`) and times made, and their ingredients are searchable. When a `.cook` file sits next to a note with the same name, which is what **Export recipe as Cooklang file** leaves behind, only the note shows.

---

## 📦 Importing and exporting files

Recipe Vault can turn recipe files already in your vault into recipes:

- **JSON-LD (`.json`):** a schema.org Recipe, the same data recipe websites carry. One file can hold several recipes.
- **Cooklang (`.cook`):** see [Cooklang](#-cooklang).

Right-click a file and choose **Import as recipe**, or run **Import recipe from JSON-LD or Cooklang file**. Obsidian only shows `.json` files in the file explorer with **Files and links → Detect all file extensions** turned on.

To import a whole folder, right-click it and choose **Import recipes from folder**. Subfolders are kept, so `Imports/Desserts/pie.json` lands in `Recipes/Desserts/`. It's safe to run again: a recipe whose URL or source file is already in your vault is skipped. Files that can't be read are listed in an `Import errors` note in the folder you imported. A folder with 1,000 or more files asks first, since the gallery gets slow with thousands of recipes.

To go the other way, right-click a recipe and choose **Export recipe as JSON-LD** or **Export recipe as Cooklang**, or use the matching commands. The file is written next to the recipe. A `.cook` file can be exported as JSON-LD too. Times made comes along, so exporting and importing a recipe back doesn't reset it.

---

## 🤖 Ask AI

Recipe Vault can use an AI model to suggest edits to a markdown recipe note directly in the note preview (for example, "make this dairy-free" or "scale to 2 servings"). This requires an [OpenRouter](https://openrouter.ai/) API key, which you can add in plugin settings.

<div align="center">

<img src="docs/panels/3-ask-ai.png" alt="Ask AI about any recipe: swap an ingredient, scale the batch, or simplify the prep, then apply the change to your note">

</div>

> **No OpenRouter key yet?** Sign up free at [openrouter.ai](https://openrouter.ai/), then grab a key from [openrouter.ai/keys](https://openrouter.ai/keys). It's pay-as-you-go (no subscription), and the default model costs well under a cent per request. Paste the key into **Recipe Vault settings → OpenRouter API key**.

The default model is `google/gemini-2.5-flash-lite`. Any OpenRouter-compatible model ID can be used, and you can optionally override the built-in system prompt in settings.

---

## 📸 Add Recipe from Photo

No cookbook page? No problem. Run **Add recipe from photo** from the command palette to turn a photographed cookbook page or recipe card into a note:

1. **Capture:** take a photo (camera opens automatically on mobile) or choose existing image files. Multiple photos are treated as pages of a single recipe, so multi-page cookbook spreads work in one go.
2. **Verify:** the vision model transcribes the name, ingredients, instructions, time, and yield; edit the result before saving to fix any misreads.
3. **Photo:** the captured photo is attached to the recipe by default, or choose a different image or none.

This uses the same [OpenRouter](https://openrouter.ai/) API key and model as Ask AI, so no separate setup is required. There's no bundled OCR engine; the vision model does the transcription, so it works on mobile too.

From my testing each recipe import from a cookbook costs under $0.001 on average (using Gemini 2.5 Flash Lite).

---

## 🔒 Network use and privacy

Recipe Vault is primarily local, but it can make network requests for the following features:

- **Recipe URL import:** fetches the page you provide to read recipe JSON-LD data. The URL and page response are used only to create recipe notes in your vault.
- **Proxy fallback (optional, off by default):** if an import is blocked and you enable this setting, the recipe URL is retried once through a public read proxy (allorigins.win), which sends that URL to a third-party service.
- **Recipe image download (optional):** when enabled, recipe images referenced by imported recipes are downloaded into your vault. This includes the image URL in an imported JSON-LD file.
- **Ask AI via OpenRouter (optional):** sends your prompt plus recipe ingredients/instructions to OpenRouter to generate suggestions. Requests include your configured OpenRouter API key.
- **Add recipe from photo via OpenRouter (optional):** sends your captured/chosen photo(s) to OpenRouter for transcription. Requests include your configured OpenRouter API key.

No ads are shown, and no telemetry is collected by Recipe Vault itself.

---

## 🏷️ Releasing

Releases are automated via GitHub Actions.

1. Go to **Actions → Tag and Release**
2. Click **Run workflow** and choose `patch`, `minor`, or `major`
3. Review the draft release and publish when ready

---

## 🙏 Credits

Recipe Vault is based on [obsidian-recipe-grabber](https://github.com/seethroughdev/obsidian-recipe-grabber) by [@seethroughdev](https://github.com/seethroughdev), which provided the original URL import foundation. This project has since been substantially rewritten and extended with new features.

---

## 📄 License

[MIT](LICENSE)
