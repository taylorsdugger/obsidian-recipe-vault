import {
  normalizeIngredientUnit,
  parseShoppingLine,
} from "../shopping/parse-line";
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

/**
 * Write a recipe note out as a Cooklang (`.cook`) file.
 *
 * Cooklang marks ingredients inline in the steps (`Add @flour{2%cups}`)
 * instead of keeping a list, and a note keeps them apart. So each ingredient
 * line is looked for in the step text, first by its name as written and then
 * by the shopping list's normalized name ("onion" for "1 yellow onion,
 * diced"), and the first unclaimed mention is marked up. When the match was
 * the short name, the step ends up saying the full one: "the onions" becomes
 * `the @yellow onion{1}(diced)`, because that name is what a Cooklang app
 * builds its ingredient list from.
 *
 * An ingredient no step mentions still goes in the file, in a "Gather …" step
 * at the top, so nothing is lost on the way out.
 *
 * Reads the note through `noteToJsonLd`, so both exports agree on what's in a
 * note. Cooking history goes out as `times made` / `last made` metadata so
 * importing the file back keeps it.
 */
export function noteToCooklang(
  markdown: string,
  opts: NoteToCooklangOptions = {},
): string {
  const recipe = noteToJsonLd(markdown, opts);

  const ingredients = ((recipe.recipeIngredient as string[] | undefined) ?? [])
    .map(splitIngredient)
    .filter((ingredient) => ingredient.name);
  const steps = (
    (recipe.recipeInstructions as { text: string }[] | undefined) ?? []
  )
    .map((step) => plainText(step.text))
    .filter(Boolean);

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

  const body = steps.map((text, s) =>
    [...claims[s]]
      .sort((a, b) => b.start - a.start)
      .reduce(
        (out, c) =>
          out.slice(0, c.start) + markup(c.ingredient) + out.slice(c.end),
        text,
      ),
  );

  const unmatched = ingredients.filter((i) => !matched.has(i));
  if (unmatched.length > 0) {
    body.unshift(`Gather ${joinList(unmatched.map(markup))}.`);
  }

  const meta: [string, string][] = [];
  if (typeof recipe.name === "string") meta.push(["title", recipe.name]);
  if (typeof recipe.url === "string") meta.push(["source", recipe.url]);
  const author = recipe.author as { name?: string } | undefined;
  if (author?.name) meta.push(["author", author.name]);
  const category = recipe.recipeCategory;
  if (category) {
    meta.push([
      "course",
      Array.isArray(category) ? category.join(", ") : String(category),
    ]);
  }
  const mins = cookTimeToMinutes(recipe.totalTime as string | undefined);
  if (mins) meta.push(["time", formatMinutes(mins)]);
  if (typeof recipe.image === "string") meta.push(["image", recipe.image]);
  const history = readRecipeVaultState(recipe);
  if (history.timesMade) meta.push(["times made", String(history.timesMade)]);
  if (history.lastMade) meta.push(["last made", history.lastMade]);

  const notes = ((recipe.recipeNotes as string[] | undefined) ?? [])
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
