import {
  normalizeIngredientUnit,
  parseShoppingLine,
} from "../shopping/parse-line";
import type { JsonRecord } from "../types";
import {
  nutritionFields,
  nutritionFromJsonLd,
  servingSizeFromJsonLd,
} from "../nutrition";
import { cookTimeToMinutes } from "./frontmatter";
import {
  noteToJsonLd,
  readRecipeVaultState,
  type NoteToJsonLdOptions,
} from "./to-json-ld";

export type NoteToCooklangOptions = NoteToJsonLdOptions;

/** One ingredient line split into the parts Cooklang's `@name{qty%unit}(prep)` needs. */
interface CooklangIngredient {
  name: string;
  quantity: string;
  unit: string;
  prep: string;
  /**
   * What to look for in the step text, best first: the name as written
   * ("yellow onion"), then the shopping list's normalized name ("onion").
   */
  keys: string[];
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

// A whole number, decimal, fraction, or mixed number ("1 1/2"). The fraction
// forms come first so "1/2" isn't read as a bare "1".
const NUMBER = String.raw`(?:\d+\s+)?\d+\s*\/\s*\d+|\d+(?:\.\d+)?`;
const QUANTITY = new RegExp(
  String.raw`^(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?`,
);

/** Characters that would read as Cooklang markup inside a name or prep note. */
function stripMarkup(text: string): string {
  return text
    .replace(/[@#~{}%()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep a step's own text from being read back as markup. Cooklang has no
 * escape character, so this changes the text as little as it can: `--` would
 * start a comment, and `@`/`#`/`~` touching a word would start an ingredient,
 * cookware, or timer.
 */
function plainText(text: string): string {
  return text
    .replace(/--/g, "–")
    .replace(/\[-/g, "[ -")
    .replace(/([@#~])(?=\S)/g, "$1 ")
    .replace(/^[=>]+\s*/, "")
    .trim();
}

/** "1 1/2 cups flour, sifted" → quantity "1 1/2", unit "cups", name "flour", prep "sifted". */
function splitIngredient(line: string): CooklangIngredient {
  let rest = line
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (ch) => ` ${UNICODE_FRACTIONS[ch]}`)
    .replace(/\s+/g, " ")
    .trim();

  let quantity = "";
  let unit = "";
  const amount = rest.match(QUANTITY);
  if (amount) {
    const tidy = (n: string) => n.replace(/\s*\/\s*/g, "/");
    quantity = amount[2]
      ? `${tidy(amount[1])}-${tidy(amount[2])}`
      : tidy(amount[1]);
    rest = rest.slice(amount[0].length).trim();

    // Only a word the shopping list knows as a unit counts as one, so
    // "2 eggs" keeps "eggs" as the name.
    const word = rest.match(/^([A-Za-z]+)\.?(?=[\s,]|$)/);
    if (word && normalizeIngredientUnit(word[1])) {
      unit = word[1];
      rest = rest.slice(word[0].length).trim();
    }
    rest = rest.replace(/^of\s+/i, "");
  }

  // "(optional)" and ", diced" both describe the ingredient rather than name
  // it, so both go to the prep note.
  const parens: string[] = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    parens.push(inner);
    return " ";
  });
  const comma = rest.indexOf(",");
  const name = stripMarkup(comma === -1 ? rest : rest.slice(0, comma));
  const tail = comma === -1 ? "" : rest.slice(comma + 1);
  const prep = [tail, ...parens].map(stripMarkup).filter(Boolean).join(", ");

  const parsed = parseShoppingLine(line);
  const keys = [
    name.toLowerCase(),
    parsed && !parsed.fragment ? parsed.name : "",
  ].filter((key, i, all) => key.length >= 3 && all.indexOf(key) === i);

  return { name: name || stripMarkup(line), quantity, unit, prep, keys };
}

/** `@olive oil{2%tbsp}(divided)`. Braces always, so a multi-word name is safe. */
function markup(ingredient: CooklangIngredient): string {
  const amount = ingredient.quantity
    ? ingredient.unit
      ? `${ingredient.quantity}%${ingredient.unit}`
      : ingredient.quantity
    : "";
  const prep = ingredient.prep ? `(${ingredient.prep})` : "";
  return `@${ingredient.name}{${amount}}${prep}`;
}

/** "a", "a and b", "a, b, and c". */
function joinList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole minutes as Cooklang's recommended `1h30m` form. */
function formatMinutes(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${hours ? `${hours}h` : ""}${minutes ? `${minutes}m` : ""}`;
}

/** Quote a front matter value when YAML would otherwise misread it. */
function yamlValue(value: string): string {
  return /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|\s$/.test(value)
    ? JSON.stringify(value)
    : value;
}

/** A schema.org field as one line of text. A list joins with ", ". */
function fieldText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map(fieldText).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object" && "name" in value) {
    return fieldText(value.name);
  }
  return "";
}

/**
 * The steps in order, with a section name ahead of each section's steps.
 * Takes schema.org's shapes: a HowToStep, a HowToSection holding steps, or a
 * bare string.
 */
function instructionBlocks(raw: unknown): ({ section: string } | string)[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ({ section: string } | string)[] => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const step = item as { name?: unknown; text?: unknown; itemListElement?: unknown };
    if (Array.isArray(step.itemListElement)) {
      const inner = instructionBlocks(step.itemListElement);
      const name = fieldText(step.name);
      return name && inner.length > 0 ? [{ section: name }, ...inner] : inner;
    }
    return typeof step.text === "string" ? [step.text] : [];
  });
}

/**
 * Write a schema.org recipe out as a Cooklang (`.cook`) file. Takes what
 * `noteToJsonLd` builds or what an import parsed off a page.
 *
 * Cooklang marks ingredients inline in the steps (`Add @flour{2%cups}`)
 * instead of keeping a list, and a recipe page keeps them apart. So each
 * ingredient line is looked for in the step text, first by its name as written
 * and then by the shopping list's normalized name ("onion" for "1 yellow
 * onion, diced"), and the first unclaimed mention is marked up. When the
 * match was the short name, the step ends up saying the full one: "the
 * onions" becomes `the @yellow onion{1}(diced)`, because that name is what a
 * Cooklang app builds its ingredient list from.
 *
 * An ingredient no step mentions still goes in the file, in a "Gather …" step
 * at the top, so nothing is lost on the way out.
 *
 * Only an http(s) image is written. A vault-local photo means nothing in the
 * file; Cooklang finds `Recipe.jpg` sitting next to `Recipe.cook` on its own.
 * Cooking history goes out as `times made` / `last made` metadata so importing
 * the file back keeps it.
 */
export function recipeToCooklang(recipe: JsonRecord): string {
  const ingredients = (
    Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : []
  )
    .filter((line): line is string => typeof line === "string")
    .map(splitIngredient)
    .filter((ingredient) => ingredient.name);
  const blocks = instructionBlocks(recipe.recipeInstructions)
    .map((block) => (typeof block === "string" ? plainText(block) : block))
    .filter(Boolean);
  const steps = blocks.filter((b): b is string => typeof b === "string");

  // Claim mentions in two passes, full names for every ingredient before any
  // short name, so "oil" for the olive oil can't take the spot where the
  // step says "vegetable oil" and that line has its own match.
  const claims = steps.map(
    () =>
      [] as { start: number; end: number; ingredient: CooklangIngredient }[],
  );
  const matched = new Set<CooklangIngredient>();
  for (const pass of [0, 1]) {
    for (const ingredient of ingredients) {
      const key = ingredient.keys[pass];
      if (!key || matched.has(ingredient)) continue;
      // A plain "s" or "es" is allowed on the end, so "onion" finds "onions".
      const pattern = new RegExp(
        String.raw`(^|[^\p{L}\p{N}])(${escapeRegExp(key)}(?:e?s)?)(?![\p{L}\p{N}])`,
        "giu",
      );
      search: for (let s = 0; s < steps.length; s++) {
        for (const match of steps[s].matchAll(pattern)) {
          const start = (match.index ?? 0) + match[1].length;
          const end = start + match[2].length;
          if (claims[s].some((c) => start < c.end && end > c.start)) continue;
          claims[s].push({ start, end, ingredient });
          matched.add(ingredient);
          break search;
        }
      }
    }
  }

  const marked = steps.map((text, s) =>
    [...claims[s]]
      .sort((a, b) => b.start - a.start)
      .reduce(
        (out, c) =>
          out.slice(0, c.start) + markup(c.ingredient) + out.slice(c.end),
        text,
      ),
  );
  let next = 0;
  const body = blocks.map((block) =>
    typeof block === "string" ? marked[next++] : `== ${plainText(block.section)} ==`,
  );

  const unmatched = ingredients.filter((i) => !matched.has(i));
  if (unmatched.length > 0) {
    body.unshift(`Gather ${joinList(unmatched.map(markup))}.`);
  }

  const meta: [string, string][] = [];
  const add = (key: string, value: string): void => {
    if (value) meta.push([key, value]);
  };
  add("title", fieldText(recipe.name));
  add("description", fieldText(recipe.description));
  if (typeof recipe.url === "string") add("source", recipe.url.trim());
  add("author", fieldText(recipe.author));
  add("course", fieldText(recipe.recipeCategory));
  add("cuisine", fieldText(recipe.recipeCuisine));
  // Pages often give a yield as ["4", "4 servings"]; the first is enough.
  add(
    "servings",
    fieldText(Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield),
  );
  const mins = cookTimeToMinutes(fieldText(recipe.totalTime) || undefined);
  if (mins) add("time", formatMinutes(mins));
  add("tags", fieldText(recipe.keywords));
  const image = fieldText(
    Array.isArray(recipe.image) ? recipe.image[0] : recipe.image,
  );
  if (/^https?:\/\//i.test(image)) add("image", image);
  const nutrition = nutritionFromJsonLd(recipe.nutrition);
  if (nutrition) {
    for (const [key, value] of Object.entries(nutritionFields(nutrition))) {
      add(key, String(value));
    }
  }
  add("serving size", servingSizeFromJsonLd(recipe.nutrition));
  const history = readRecipeVaultState(recipe);
  if (history.timesMade) add("times made", String(history.timesMade));
  if (history.lastMade) add("last made", history.lastMade);

  const notes = (Array.isArray(recipe.recipeNotes) ? recipe.recipeNotes : [])
    .filter((note): note is string => typeof note === "string")
    .map(plainText)
    .filter(Boolean)
    .map((note) => `> ${note}`);

  const parts: string[] = [];
  if (meta.length > 0) {
    parts.push(
      [
        "---",
        ...meta.map(([key, value]) => `${key}: ${yamlValue(value)}`),
        "---",
      ].join("\n"),
    );
  }
  parts.push(...body, ...notes);
  return `${parts.join("\n\n")}\n`;
}

/**
 * Write a recipe note out as a Cooklang (`.cook`) file. Reads the note
 * through `noteToJsonLd`, so both exports agree on what's in a note.
 */
export function noteToCooklang(
  markdown: string,
  opts: NoteToCooklangOptions = {},
): string {
  return recipeToCooklang(noteToJsonLd(markdown, opts));
}
