# @recipe-vault/core

The recipe code behind the [Recipe Vault](https://github.com/taylorsdugger/obsidian-recipe-vault) Obsidian plugin, pulled out so it runs anywhere. It parses recipes out of web pages and Cooklang files, scales them, works out nutrition, and turns ingredient lines into a merged shopping list. It has no Obsidian code in it.

```bash
npm install @recipe-vault/core
```

It ships as ES modules with type declarations.

## Parse a recipe page

`parseRecipesFromHtml` reads every schema.org Recipe on a page (JSON-LD first, then microdata) and cleans it up for a note. It doesn't touch the network.

```ts
import { parseRecipesFromHtml } from "@recipe-vault/core";

const recipes = parseRecipesFromHtml(html, new URL(pageUrl), {
  useBuiltInFillerWords: true,
  extraFillerWords: "",
  keptFillerWords: "",
  filterVeganWords: false,
  filterGlutenFreeWords: false,
  defaultLanguage: "en",
});
```

The filler word options strip marketing words out of titles. "The Best Easy Vegan Lasagna" comes back as "Vegan Lasagna", or just "Lasagna" with `filterVeganWords` on. The word lists are per language and ship as json under `@recipe-vault/core/parse/title-words/<code>.json`.

To fetch the page too, use `fetchRecipes`. It takes an `HttpPort`, which is just an object with a `get(url, headers)` method. The plugin backs it with Obsidian's `requestUrl` and a web app can back it with `fetch`. That keeps the core free of any one runtime's network api.

## Scaling and shopping lists

```ts
import { scaleIngredientLine } from "@recipe-vault/core/scale";
import {
  itemsFromIngredientLine,
  mergeShoppingItems,
} from "@recipe-vault/core";

scaleIngredientLine("1 1/2 cups flour", 2); // "3 cups flour"

const list = mergeShoppingItems(
  itemsFromIngredientLine("2 cups milk", "Pancakes"),
  itemsFromIngredientLine("1 cup milk", "Waffles"),
);
// one row: 3 cups milk, from Pancakes and Waffles
```

Everything is on the root import. Each module also has its own subpath, like `@recipe-vault/core/scale`, `@recipe-vault/core/nutrition` or `@recipe-vault/core/shopping/markdown`, if you'd rather import less.

`createRecipeRenderer(DEFAULT_TEMPLATE)` gives you the Handlebars renderer the plugin uses to write a recipe note. `parseCooklang` and `cooklangToJsonLd` read `.cook` files, and `noteToCooklang` and `noteToJsonLd` go the other way.

## Versions

It's 0.x, so a minor version can break the api. Pin it if that matters to you.

## Developing

The source lives in [packages/core](https://github.com/taylorsdugger/obsidian-recipe-vault/tree/main/packages/core) in the plugin's repo. `npm run build` writes `dist/` with tsup, and `npm test` runs the tests. The plugin bundles core straight from `src/`, so you don't need a build to work on the plugin.

## License

MIT
