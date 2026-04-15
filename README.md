# Recipe Vault

**Recipe Vault** is a full recipe management system for Obsidian — import from web, image, or scratch, browse your vault visually, and build shopping lists automatically

Paste a URL, get a clean recipe note. Browse your collection in a visual gallery. Build a shopping list straight from your ingredients. No subscriptions, no accounts, no ads — just your recipes in your vault.

---

## Features

- **Import from URL** — Fetches structured recipe data (JSON-LD) from any recipe page and creates a formatted note instantly.
- **Import from image** — Scan a photographed recipe card or cookbook page with OCR, then review and save it as a recipe note.
- **Add recipes manually** — Create a recipe note from scratch using the same template.
- **Recipe Gallery** — Browse your recipe vault visually with a dedicated gallery view.
- **Shopping list** — Check off ingredients in a recipe note and send them directly to your shopping list file. Handles unit merging automatically.
- **Mark as made** — Track when you last made a recipe and how many times.
- **Ask AI for recipe edits** — Request modifications to a recipe using an AI model via OpenRouter (API key required).
- **Customizable templates** — Full Handlebars template support so your notes look exactly how you want.

> **Note:** Image-based OCR import is included as an early experimental feature. It works in basic cases but is not yet reliable enough for everyday use.

---

## Installation

### From the Obsidian Plugin Store

1. Open Obsidian → **Settings** → **Community plugins**
2. Search for **Recipe Vault**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/taylorsdugger/obsidian-recipe-vault/releases/latest).
2. Copy them into your vault at: `.obsidian/plugins/recipe-vault/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

---

## Quick Start

1. Click the **chef hat icon** in the ribbon (or run **Import Recipe** from the command palette).
2. Paste a recipe URL and press Enter.
3. Your recipe note will be created in the configured save folder.

To browse your recipes, click the **utensils icon** in the ribbon to open the Recipe Gallery.

---

## Commands

| Command | What it does |
|---|---|
| **Import Recipe** | Opens a URL prompt and imports a recipe into a new note |
| **Open Recipe Gallery** | Opens the visual gallery of your recipe notes |
| **Mark Recipe as Made** | Increments `times_made` and sets `last_made` to today on the active note |
| **Add checked ingredients to shopping list** | Sends checked ingredients from the active recipe to your shopping list file |
| **Clear checked items from shopping list** | Removes completed items from your shopping list |
| **Add recipe (manual)** | Creates a new recipe note from a title prompt |
| **Add recipe from image** | Scans a recipe from a photo using OCR and lets you review it before saving |
| **Batch import recipes from URL list** | Imports multiple recipes from a list of URLs (one per line) in the active note |

---

## Settings

| Setting | Description |
|---|---|
| **Recipe save folder** | Where new recipe notes are created |
| **Save in currently opened file** | Import into the active note instead of creating a new one |
| **Save images** | Download recipe images into your vault |
| **Save images in subdirectories** | Create a per-recipe subfolder under the image folder |
| **Recipe template** | Handlebars template used when creating recipe notes |
| **Decode Entities** | Decodes HTML entities in imported data |
| **OCR strict cleanup** | More aggressively filters OCR noise during image-based recipe import |
| **Shopping list file** | Path to your shopping list note (created automatically if missing) |
| **Recipe gallery folder** | The folder the Recipe Gallery browses |
| **OpenRouter API key** | Required for Ask AI features |
| **AI model ID** | Which model to use for Ask AI (default: `google/gemini-2.5-flash-lite`) |
| **AI request timeout (ms)** | Timeout for AI requests (minimum 5000 ms) |
| **Custom AI system prompt** | Optional override for the built-in Ask AI instructions |
| **Recipe title filler words** | Controls how imported titles are cleaned up |
| **Filter vegan words / gluten-free words** | Optionally strips dietary labels from imported recipe titles |
| **Debug mode** | Enables extra developer logging |

---

## Custom Templates

Recipe Vault uses [Handlebars](https://handlebarsjs.com/guide/#simple-expressions) for note templates. The plugin assumes the recipe page includes [JSON-LD structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe).

### Built-in Helpers

**`splitTags`** — Converts comma-separated tags into a YAML list for Obsidian frontmatter:
```handlebars
tags:
{{splitTags keywords}}
```

**`photoFrontmatter`** — Formats image values correctly for frontmatter (wikilink for local files, URL for remote):
```handlebars
photo: "{{photoFrontmatter image}}"
```

**`magicTime`** — Formats ISO durations and timestamps into readable values:
```handlebars
DateSaved: {{magicTime}}
CookTime: {{magicTime cookTime}}
TotalTime: {{magicTime totalTime}}
DatePublished: {{magicTime datePublished "dd-mm-yyyy"}}
```

Example output:
```
DateSaved: 2024-04-13 20:10
CookTime: 15m
TotalTime: 1h 5m
```

### Default Frontmatter Fields

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

> **Tip:** Keep frontmatter starting at line 1 of your template. Obsidian requires this to parse it correctly.

---

## Ask AI

Recipe Vault can use an AI model to suggest edits to a recipe directly in the note preview (e.g., "make this dairy-free" or "scale to 2 servings"). This requires an [OpenRouter](https://openrouter.ai/) API key, which you can add in plugin settings.

The default model is `google/gemini-2.5-flash-lite`. Any OpenRouter-compatible model ID can be used, and you can optionally override the built-in system prompt in settings.

## Network use and privacy disclosure

Recipe Vault is primarily local, but it can make network requests for the following features:

- **Recipe URL import**: Fetches the page you provide to read recipe JSON-LD data. The URL and page response are used only to create recipe notes in your vault.
- **Recipe image download (optional)**: When enabled, recipe images referenced by imported recipes are downloaded into your vault.
- **Ask AI via OpenRouter (optional)**: Sends your prompt plus recipe ingredients/instructions to OpenRouter to generate suggestions. Requests include your configured OpenRouter API key.

No ads are shown, and no telemetry is collected by Recipe Vault itself.

---

## Releasing

Releases are automated via GitHub Actions.

1. Go to **Actions → Tag and Release**
2. Click **Run workflow** and choose `patch`, `minor`, or `major`
3. Review the draft release and publish when ready

---

## Credits

Recipe Vault is based on [obsidian-recipe-grabber](https://github.com/seethroughdev/obsidian-recipe-grabber) by [@seethroughdev](https://github.com/seethroughdev), which provided the original URL import foundation. This project has since been substantially rewritten and extended with new features.

---

## License

[MIT](LICENSE)