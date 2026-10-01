// Builds a throwaway Obsidian vault full of fake recipe notes, to see how the
// gallery and ingredient index hold up at the size of a big bulk import.
//
//   node scripts/load-test-vault.mjs              18,000 notes, plugin installed
//   node scripts/load-test-vault.mjs --count 2000
//   node scripts/load-test-vault.mjs --notes-only  just (re)write the notes
//   node scripts/load-test-vault.mjs --out .loadtest-import --sources 500
//
// The notes follow DEFAULT_TEMPLATE and are spread over nested cookbook
// folders under Recipes/, the way a folder import that keeps the source
// structure would lay them out. Output is seeded, so every run is the same.
//
// --sources writes that many recipe files to import instead of notes: mostly
// JSON-LD, some Cooklang, in nested folders under Imports/. Point "Import
// recipes from folder" at Imports to try the folder import at that size.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const count = Number(option("count", "18000"));
const vaultDir = resolve(option("out", ".loadtest-vault"));
const notesOnly = flag("notes-only");
const sources = Number(option("sources", "0"));

if (!Number.isInteger(count) || count < 1) {
  console.error(`--count needs a positive whole number, got ${option("count")}`);
  process.exit(1);
}

// mulberry32, so the same seed gives the same vault every time.
let seed = 12345;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const COOKBOOKS = [
  "Appetizers", "Breads", "Breakfast", "Cakes", "Candy", "Casseroles",
  "Cookies", "Desserts", "Drinks", "Fish", "Grilling", "Holiday", "Lamb",
  "Pasta", "Pies", "Pork", "Poultry", "Preserves", "Salads", "Sauces",
  "Seafood", "Side Dishes", "Slow Cooker", "Soups", "Stews", "Vegetables",
];
const SUBFOLDERS = ["", "", "", "Family", "Magazines", "Newsgroup Archive"];

const ADJECTIVES = [
  "Grandma's", "Easy", "Spicy", "Smoky", "Lemon", "Garlic", "Honey",
  "Creamy", "Crispy", "Baked", "Braised", "Quick", "Country", "Old Fashioned",
  "Herbed", "Maple", "Roasted", "Southern", "Tangy", "Sweet and Sour",
];
const MAINS = [
  "Chicken", "Beef", "Pork", "Salmon", "Shrimp", "Lentil", "Mushroom",
  "Potato", "Apple", "Pumpkin", "Tomato", "Black Bean", "Turkey", "Cod",
  "Zucchini", "Corn", "Cabbage", "Chickpea", "Sausage", "Spinach",
];
const DISHES = [
  "Soup", "Stew", "Casserole", "Pie", "Salad", "Bread", "Muffins", "Chili",
  "Curry", "Bake", "Skillet", "Tacos", "Pasta", "Risotto", "Cake", "Fritters",
  "Loaf", "Gratin", "Stir Fry", "Dumplings",
];
const INGREDIENTS = [
  "all-purpose flour", "granulated sugar", "brown sugar", "unsalted butter",
  "eggs", "whole milk", "heavy cream", "kosher salt", "black pepper",
  "olive oil", "vegetable oil", "garlic, minced", "yellow onion, diced",
  "carrots, sliced", "celery, chopped", "chicken broth", "beef broth",
  "canned tomatoes", "tomato paste", "dried oregano", "dried thyme",
  "bay leaves", "paprika", "ground cumin", "chili powder", "baking soda",
  "baking powder", "vanilla extract", "ground cinnamon", "lemon juice",
  "soy sauce", "honey", "dijon mustard", "parmesan cheese, grated",
  "cheddar cheese, shredded", "fresh parsley, chopped", "green onions, sliced",
  "red bell pepper, diced", "potatoes, cubed", "long grain rice",
];
const UNITS = ["cup", "cups", "tbsp", "tsp", "oz", "lb", "", "cloves", "cans"];
const QUANTITIES = ["1", "2", "3", "1/2", "1/4", "3/4", "1 1/2", "4", "6"];
const STEPS = [
  "Preheat the oven to 350 degrees F.",
  "Heat the oil in a large pot over medium heat.",
  "Add the onion and cook until soft, about 5 minutes.",
  "Stir in the garlic and cook for 1 minute more.",
  "Whisk the dry ingredients together in a medium bowl.",
  "Beat the butter and sugar until light and fluffy.",
  "Add the broth and bring to a boil, then reduce to a simmer.",
  "Cover and cook for 30 minutes, stirring now and then.",
  "Pour into a greased 9x13 pan and spread it out evenly.",
  "Bake until golden and a toothpick comes out clean.",
  "Season to taste with salt and pepper.",
  "Let it cool for 10 minutes before serving.",
  "Garnish with the parsley and serve warm.",
];
const MEAL_TYPES = ["Dinner", "Lunch", "Breakfast", "Dessert", "Side", "Snack"];
const COOK_TIMES = ["15m", "25m", "30m", "45m", "1h", "1h 15m", "1h 30m", "2h", "4h"];
const AUTHORS = ["", "", "MasterCook", "Betty", "Unknown", "Church Cookbook 1987"];

function recipeNote(name) {
  const ingredients = Array.from({ length: between(4, 16) }, () =>
    [pick(QUANTITIES), pick(UNITS), pick(INGREDIENTS)].filter(Boolean).join(" "),
  );
  const steps = Array.from({ length: between(3, 10) }, () => pick(STEPS));
  const mealType = pick(MEAL_TYPES);
  const cookTime = pick(COOK_TIMES);
  const author = pick(AUTHORS);
  // Most imported recipes have never been made. A few have some history.
  const timesMade = random() < 0.85 ? 0 : between(1, 12);
  const year = between(1994, 2012);

  return `---
cssclasses: recipe-note
tags:
- recipe
date_added: 2026-09-28
created: ${year}-0${between(1, 9)}-1${between(0, 9)}
meal_type: ${mealType}
author: ${author}
cook_time: ${cookTime}
url:
photo: ""
times_made: ${timesMade}
last_made:${timesMade > 0 ? " 2026-08-01" : ""}
---

# [${name}]()


> [!recipe-meta] At a Glance
> **Meal type**: ${mealType}
> **Cook time**: ${cookTime}
${author ? `> **Author**: ${author}\n` : ""}
### Ingredients

${ingredients.map((line) => `- [ ] ${line}`).join("\n")}

### Instructions

${steps.map((step) => `- ${step}`).join("\n")}

-----

## Notes
${random() < 0.3 ? "- From the old MasterCook archive.\n" : ""}`;
}

/** The same kind of fake recipe as a note, as the JSON-LD an import reads. */
function recipeJsonLd(name) {
  const ingredients = Array.from({ length: between(4, 16) }, () =>
    [pick(QUANTITIES), pick(UNITS), pick(INGREDIENTS)].filter(Boolean).join(" "),
  );
  const author = pick(AUTHORS);
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    ...(author ? { author: { "@type": "Person", name: author } } : {}),
    recipeCategory: pick(MEAL_TYPES),
    totalTime: `PT${between(1, 3)}H${between(0, 5)}0M`,
    recipeIngredient: ingredients,
    recipeInstructions: Array.from({ length: between(3, 10) }, () => ({
      "@type": "HowToStep",
      text: pick(STEPS),
    })),
  };
}

/** A Cooklang file: each step marks up a couple of ingredients inline. */
function recipeCook(name) {
  const steps = Array.from({ length: between(3, 8) }, () => {
    const a = pick(INGREDIENTS).split(",")[0];
    const b = pick(INGREDIENTS).split(",")[0];
    return `Add @${a}{${pick(QUANTITIES)}%${pick(UNITS) || "cup"}} and @${b}{}, then stir for ~{${between(2, 20)}%minutes}.`;
  });
  return `---\ntitle: ${name}\ncourse: ${pick(MEAL_TYPES)}\ntime: ${between(1, 3)}h${between(0, 5)}0m\n---\n\n${steps.join("\n\n")}\n`;
}

function writeSources() {
  const importsDir = join(vaultDir, "Imports");
  rmSync(importsDir, { recursive: true, force: true });

  const used = new Set();
  const started = Date.now();
  for (let i = 0; i < sources; i++) {
    const folder = join(importsDir, pick(COOKBOOKS), pick(SUBFOLDERS));
    mkdirSync(folder, { recursive: true });

    const name = `${pick(ADJECTIVES)} ${pick(MAINS)} ${pick(DISHES)}`;
    const cook = random() < 0.2;
    let file = `${name}.${cook ? "cook" : "json"}`;
    for (let n = 2; used.has(join(folder, file)); n++) {
      file = `${name} (${n}).${cook ? "cook" : "json"}`;
    }
    used.add(join(folder, file));

    writeFileSync(
      join(folder, file),
      cook ? recipeCook(name) : JSON.stringify(recipeJsonLd(name), null, 2),
    );
  }
  console.log(`wrote ${sources} recipe files to ${importsDir} in ${Date.now() - started}ms`);
}

function installPlugin() {
  const pluginDir = join(vaultDir, ".obsidian", "plugins", "recipe-vault");
  if (!existsSync("main.js")) {
    console.error("main.js not found. Run `npm run build` first.");
    process.exit(1);
  }
  mkdirSync(pluginDir, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    copyFileSync(file, join(pluginDir, file));
  }
  writeFileSync(
    join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(["recipe-vault"]),
  );
  // Only the save folder matters here. The plugin fills in the rest.
  writeFileSync(
    join(pluginDir, "data.json"),
    JSON.stringify({ folder: "Recipes" }, null, 2),
  );
  console.log(`installed plugin into ${pluginDir}`);
}

function writeNotes() {
  const recipesDir = join(vaultDir, "Recipes");
  rmSync(recipesDir, { recursive: true, force: true });

  const used = new Set();
  const started = Date.now();
  for (let i = 0; i < count; i++) {
    const folder = join(recipesDir, pick(COOKBOOKS), pick(SUBFOLDERS));
    mkdirSync(folder, { recursive: true });

    // Same "Name (2)" rule the plugin uses when a title is already taken. The
    // suffix only goes on the file name, the heading keeps the recipe's name.
    const base = `${pick(ADJECTIVES)} ${pick(MAINS)} ${pick(DISHES)}`;
    let title = base;
    for (let n = 2; used.has(join(folder, title)); n++) title = `${base} (${n})`;
    used.add(join(folder, title));

    writeFileSync(join(folder, `${title}.md`), recipeNote(base));
  }
  console.log(`wrote ${count} notes to ${recipesDir} in ${Date.now() - started}ms`);
}

mkdirSync(vaultDir, { recursive: true });
if (!notesOnly) installPlugin();
if (sources > 0) writeSources();
else writeNotes();
