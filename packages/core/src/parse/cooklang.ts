import { cookTimeToMinutes } from "../note/frontmatter";
import {
  minutesToIsoDuration,
  VAULT_STATE_KEY,
  type RecipeVaultState,
} from "../note/to-json-ld";
import type { JsonRecord } from "../types";

/**
 * Cooklang front matter, flattened. Keys are lowercased, and a nested map is
 * folded into dotted keys (`source:` / `  url: …` becomes `source.url`), which
 * is how the Cooklang conventions name the nested forms anyway.
 */
type CooklangMetadata = Record<string, string | string[]>;

export interface CooklangToJsonLdOptions {
  /**
   * The recipe's name when the file has no `title` in its front matter.
   * Callers with a file should pass its basename: most `.cook` files are
   * named after the recipe and never repeat it inside.
   */
  name?: string;
}

/** One `@ingredient` or `#cookware` reference pulled out of a step. */
interface CooklangIngredient {
  name: string;
  quantity: string;
  unit: string;
  prep: string;
  /** `@&name`: points back at an earlier ingredient rather than adding one. */
  reference: boolean;
}

interface CooklangSection {
  name: string;
  steps: string[];
}

/** Drop one layer of matching quotes around a YAML scalar. */
function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length > 1 &&
    ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Read Cooklang's YAML front matter. Handles what recipe files actually use -
 * `key: value`, block and `[inline]` lists, and one level of nesting - rather
 * than pulling in a YAML parser for it.
 */
function parseFrontMatter(block: string): CooklangMetadata {
  const meta: CooklangMetadata = {};
  // The last top-level key with an empty value. Indented lines under it are
  // either its list items or its nested keys.
  let parent: string | null = null;

  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const indented = /^\s/.test(raw);

    const item = line.match(/^-\s+(.*)$/);
    if (item) {
      if (!parent) continue;
      const list = meta[parent];
      meta[parent] = [...(Array.isArray(list) ? list : []), unquote(item[1])];
      continue;
    }

    const pair = line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!pair) continue;
    const key = (indented && parent ? `${parent}.${pair[1]}` : pair[1])
      .trim()
      .toLowerCase();
    const value = pair[2].trim();
    if (!indented) parent = value === "" ? key : null;
    if (value === "") continue;

    meta[key] =
      value.startsWith("[") && value.endsWith("]")
        ? value.slice(1, -1).split(",").map(unquote).filter(Boolean)
        : unquote(value);
  }
  return meta;
}

/** The first of `keys` with a value, as one string. Lists join with ", ". */
function metaValue(meta: CooklangMetadata, ...keys: string[]): string {
  for (const key of keys) {
    const value = meta[key];
    const text = Array.isArray(value) ? value.join(", ") : value;
    if (text?.trim()) return text.trim();
  }
  return "";
}

/**
 * Strip `--` line comments and `[- block -]` comments. A line that was only a
 * comment goes away entirely, so it can't split one step into two.
 *
 * `---` is left alone. The spec's own tests keep it as text in a step body,
 * and a `--` that's really the start of a rule shouldn't eat the line.
 */
function stripComments(body: string): string {
  return body
    .replace(/\[-[\s\S]*?-\]/g, "")
    .split("\n")
    .flatMap((line) => {
      const stripped = line.replace(/(^|[^-])--(?!-).*$/, "$1");
      return stripped.trim() === "" && line.trim() !== "" ? [] : [stripped];
    })
    .join("\n");
}

/** `{ 1 / 2 % cup }` → quantity "1/2", unit "cup". */
function parseAmount(inner: string): { quantity: string; unit: string } {
  const split = inner.indexOf("%");
  const rawQuantity = split === -1 ? inner : inner.slice(0, split);
  const unit = split === -1 ? "" : inner.slice(split + 1).trim();
  const quantity = rawQuantity
    .trim()
    // `=` fixes an amount so it doesn't scale. Nothing here scales.
    .replace(/^=\s*/, "")
    .replace(/\s*\/\s*/g, "/");
  return { quantity, unit };
}

// A single-word name runs until whitespace or punctuation.
const WORD = /^[\p{L}\p{N}\p{M}_]+/u;
// A multi-word name runs to the `{`, as long as another marker doesn't come first.
const MULTI_WORD = /^([^\s@#~{}][^@#~{}\n]*?)\{([^}]*)\}/u;
const PREP = /^\(([^)]*)\)/;
const TIMER = /^([\p{L}\p{N}\p{M}_]*)\{([^}]*)\}/u;

/** The name (and `{…}` amount, if any) right after an `@` or `#`. */
function readName(
  rest: string,
): { name: string; amount: string; length: number } | null {
  const multi = rest.match(MULTI_WORD);
  if (multi) {
    return { name: multi[1].trim(), amount: multi[2], length: multi[0].length };
  }
  const word = rest.match(WORD);
  if (word) return { name: word[0], amount: "", length: word[0].length };
  return null;
}

/**
 * Turn one step's markup into plain text, collecting its ingredients.
 * `@olive oil{2%tbsp}` reads back as "olive oil", `#pot` as "pot", and
 * `~{25%minutes}` as "25 minutes". Anything that isn't valid markup, like
 * "email me @ home", is kept as written.
 */
function renderStep(source: string): {
  text: string;
  ingredients: CooklangIngredient[];
} {
  const ingredients: CooklangIngredient[] = [];
  let text = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i + 1);

    const marker = ch === "@" || ch === "#" ? readName(rest) : null;
    if (marker) {
      let consumed = marker.length;
      const amount = parseAmount(marker.amount);
      const prep = source.slice(i + 1 + consumed).match(PREP);
      if (prep) consumed += prep[0].length;

      // `@&flour{}` references an earlier ingredient; `@?` marks it
      // optional. Neither changes what the name is.
      const reference = /^[&?]*&/.test(marker.name);
      // A recipe reference (`@./sauces/Hollandaise{}`) reads as its name.
      const name = marker.name
        .replace(/^[&?]+/, "")
        .replace(/^.*\//, "")
        .trim();

      text += name;
      if (ch === "@") {
        ingredients.push({
          name,
          quantity: amount.quantity,
          unit: amount.unit,
          prep: prep ? prep[1].trim() : "",
          reference,
        });
      }
      i += 1 + consumed;
      continue;
    }

    if (ch === "~") {
      const timer = rest.match(TIMER);
      const single = timer ? null : rest.match(WORD);
      if (timer) {
        const { quantity, unit } = parseAmount(timer[2]);
        text += [quantity, unit].filter(Boolean).join(" ") || timer[1];
        i += 1 + timer[0].length;
        continue;
      }
      if (single) {
        // A bare `~rest` is a named timer with no time on it.
        text += single[0];
        i += 1 + single[0].length;
        continue;
      }
    }

    text += ch;
    i++;
  }

  return { text: text.replace(/\s+/g, " ").trim(), ingredients };
}

/** "1/2 cup milk, warmed", the way an ingredient line reads in a note. */
function ingredientLine(ingredient: CooklangIngredient): string {
  const line = [ingredient.quantity, ingredient.unit, ingredient.name]
    .filter(Boolean)
    .join(" ");
  return ingredient.prep ? `${line}, ${ingredient.prep}` : line;
}

/**
 * Build a schema.org Recipe from a Cooklang (`.cook`) file, so it can go
 * through the same normalize pass as a JSON-LD import.
 *
 * Cooklang has no ingredient list of its own. Ingredients are marked inline
 * in the steps, so the list is collected in the order they first show up. An
 * ingredient mentioned again without an amount ("stir in the @butter") is the
 * same one and isn't listed twice; one given a second amount is.
 *
 * Front matter maps onto schema.org by the Cooklang canonical metadata names:
 * `source` becomes the url when it is one, `course` or `category` the meal
 * type, `time` (or prep time plus cook time) the total time. The older
 * `>> key: value` metadata lines are read too.
 */
export function cooklangToJsonLd(
  source: string,
  opts: CooklangToJsonLdOptions = {},
): JsonRecord {
  let body = source.replace(/\r\n?/g, "\n");
  let meta: CooklangMetadata = {};

  const frontMatter = body.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (frontMatter) {
    meta = parseFrontMatter(frontMatter[1]);
    body = body.slice(frontMatter[0].length);
  }

  const sections: CooklangSection[] = [{ name: "", steps: [] }];
  const notes: string[] = [];
  const ingredients: string[] = [];
  const listed = new Set<string>();
  let paragraph: string[] = [];

  const flushStep = (): void => {
    // A line ending in `\` is a forced line break. A note's list item can't
    // hold one, so it reads as a space like any other line join.
    const joined = paragraph
      .map((line) => line.replace(/\\\s*$/, ""))
      .join(" ");
    paragraph = [];
    const { text, ingredients: found } = renderStep(joined);
    if (text) sections[sections.length - 1].steps.push(text);

    for (const ingredient of found) {
      const key = ingredient.name.toLowerCase();
      if (ingredient.reference) continue;
      if (listed.has(key) && !ingredient.quantity) continue;
      listed.add(key);
      ingredients.push(ingredientLine(ingredient));
    }
  };

  for (const line of stripComments(body).split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushStep();
      continue;
    }

    const legacyMeta = trimmed.match(/^>>\s*([^:]+?)\s*:\s*(.*)$/);
    if (legacyMeta) {
      flushStep();
      meta[legacyMeta[1].toLowerCase()] = unquote(legacyMeta[2]);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushStep();
      const note = trimmed.replace(/^>\s*/, "");
      if (note) notes.push(note);
      continue;
    }

    const section = trimmed.match(/^=+\s*(.*?)\s*=*$/);
    if (section) {
      flushStep();
      sections.push({ name: section[1], steps: [] });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushStep();

  const recipe: JsonRecord = {
    "@context": "https://schema.org",
    "@type": "Recipe",
  };

  const name = metaValue(meta, "title") || (opts.name ?? "").trim();
  if (name) recipe.name = name;

  const sourceValue = metaValue(meta, "source", "source.url");
  const url = /^https?:\/\//i.test(sourceValue)
    ? sourceValue
    : metaValue(meta, "source.url");
  if (url) recipe.url = url;

  const author = metaValue(meta, "author", "source.author");
  if (author) recipe.author = { "@type": "Person", name: author };

  const description = metaValue(meta, "description", "introduction");
  if (description) recipe.description = description;

  const image = metaValue(meta, "image", "images", "picture", "pictures")
    .split(",")[0]
    .trim();
  if (/^https?:\/\//i.test(image)) recipe.image = image;

  const category = metaValue(meta, "course", "category");
  if (category) recipe.recipeCategory = category;

  const cuisine = metaValue(meta, "cuisine");
  if (cuisine) recipe.recipeCuisine = cuisine;

  const servings = metaValue(meta, "servings", "serves");
  if (servings) recipe.recipeYield = servings;

  const tags = metaValue(meta, "tags");
  if (tags) recipe.keywords = tags;

  // Total time, or prep plus cook when that's all the file has. Handed on as
  // an ISO duration, which is what the template's time helper reads.
  const total = metaValue(meta, "time required", "time", "duration");
  const totalMins = cookTimeToMinutes(total);
  const prepMins = cookTimeToMinutes(metaValue(meta, "prep time", "time.prep"));
  const cookMins = cookTimeToMinutes(metaValue(meta, "cook time", "time.cook"));
  if (totalMins) recipe.totalTime = minutesToIsoDuration(totalMins);
  else if (total) recipe.totalTime = total;
  else if (prepMins || cookMins) {
    recipe.totalTime = minutesToIsoDuration((prepMins ?? 0) + (cookMins ?? 0));
  }

  if (ingredients.length > 0) recipe.recipeIngredient = ingredients;

  // Named sections become HowToSections. Steps before the first named
  // section, or a file whose sections are all unnamed `==`, stay plain steps.
  const instructions = sections.flatMap((section): JsonRecord[] => {
    const steps = section.steps.map((text) => ({ "@type": "HowToStep", text }));
    if (!section.name) return steps;
    if (steps.length === 0) return [];
    return [
      { "@type": "HowToSection", name: section.name, itemListElement: steps },
    ];
  });
  if (instructions.length > 0) recipe.recipeInstructions = instructions;

  if (notes.length > 0) recipe.recipeNotes = notes;

  // Cooking history written by our own export. Read back the same way a
  // JSON-LD round trip does, so it isn't reset on the way in.
  const vaultState: RecipeVaultState = {};
  const timesMade = Number(metaValue(meta, "times made"));
  if (Number.isFinite(timesMade) && timesMade > 0) {
    vaultState.timesMade = Math.round(timesMade);
  }
  const lastMade = metaValue(meta, "last made");
  if (lastMade) vaultState.lastMade = lastMade;
  if (Object.keys(vaultState).length > 0) {
    recipe[VAULT_STATE_KEY] = vaultState;
  }

  return recipe;
}
