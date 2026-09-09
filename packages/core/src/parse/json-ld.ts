import {
  isJsonRecord,
  type InstructionItem,
  type InstructionStep,
  type JsonRecord,
  type ParsedRecipe,
} from "../types";
import { cleanRecipeName, type CleanNameOptions } from "./clean-name";
import { stripHtml } from "./html";
import { normalizeImages } from "./images";
import { normalizeRecipeNotes } from "./notes";

/** Everything the pure JSON-LD walk reads. No DOM, no vault, no network. */
export interface JsonLdParseOptions extends CleanNameOptions {
  /**
   * The page the JSON-LD came from. Stamped onto every recipe's `url`,
   * overriding whatever the schema itself carries, because the page URL is
   * the authoritative source for a web import. Omit it when parsing a
   * standalone `.json` file: the recipe keeps its own `url` if it has one.
   */
  sourceUrl?: string;
}

/**
 * Walk parsed JSON-LD and normalize every schema.org Recipe in it for
 * templating.
 *
 * `blocks` is one entry per source (one `<script type="application/ld+json">`
 * block, or one `.json` file), each already `JSON.parse`d. Passing them
 * together rather than one at a time matters: `@id` references routinely point
 * across block boundaries, and every block is indexed before any is walked.
 */
export function parseRecipesFromJsonLd(
  blocks: unknown[],
  opts: JsonLdParseOptions,
): ParsedRecipe[] {
  const recipes: ParsedRecipe[] = [];

  /**
   * Many sites (Yoast/WordPress, etc.) express the whole page as a single
   * JSON-LD `@graph` where nodes reference each other by `@id` instead of
   * inlining them — e.g. a Recipe's author is `{ "@id": ".../person/123" }`
   * pointing at a separate Person node. Index every node that carries an
   * `@id` so those references can be resolved back to the real object.
   */
  const nodesById = new Map<string, JsonRecord>();
  const indexNodes = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(indexNodes);
      return;
    }
    if (!isJsonRecord(value)) return;
    const id = value["@id"];
    // Only index real nodes (more than just an "@id" pointer).
    if (typeof id === "string" && Object.keys(value).length > 1) {
      if (!nodesById.has(id)) nodesById.set(id, value);
    }
    for (const key of Object.keys(value)) {
      indexNodes(value[key]);
    }
  };

  /** Follow a bare `{ "@id": "..." }` pointer to its indexed node. */
  const resolveRef = (value: unknown): unknown => {
    if (isJsonRecord(value) && Object.keys(value).length === 1) {
      const id = value["@id"];
      if (typeof id === "string") return nodesById.get(id) ?? value;
    }
    return value;
  };

  /** Reduce an author value (string | object | ref | array) to a plain name. */
  const authorName = (value: unknown): string => {
    const resolved = resolveRef(value);
    if (typeof resolved === "string") return resolved.trim();
    if (isJsonRecord(resolved)) {
      const name = resolved.name;
      return typeof name === "string" ? name.trim() : "";
    }
    return "";
  };

  /**
   * Reduce an ingredient value (string | object | `@id` ref) to a clean
   * line, resolving references and stripping any inline HTML.
   */
  const ingredientText = (value: unknown): string => {
    const resolved = resolveRef(value);
    if (typeof resolved === "string") return stripHtml(resolved);
    if (isJsonRecord(resolved)) {
      const text = resolved.name ?? resolved.text;
      return typeof text === "string" ? stripHtml(text) : "";
    }
    return "";
  };

  /**
   * Normalize one instruction entry into the shape the template expects: a
   * HowToSection `{ name, itemListElement: [{ text, image? }] }` or a plain
   * step `{ text, image? }`. Coerces bare strings, resolves `@id` refs, and
   * strips inline HTML from every text value. `image` is preserved verbatim
   * so the downstream instruction-image download loop is unaffected.
   */
  const normalizeInstructionStep = (step: unknown): InstructionStep => {
    const resolved = resolveRef(step);
    if (typeof resolved === "string") {
      return { text: stripHtml(resolved) };
    }
    if (!isJsonRecord(resolved)) {
      return { text: "" };
    }

    const type = resolved["@type"];
    const isSection = Array.isArray(type)
      ? type.includes("HowToSection")
      : type === "HowToSection";

    const rawItems = resolved.itemListElement;
    if (isSection || Array.isArray(rawItems)) {
      const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
      const itemListElement = list
        .map((el): InstructionItem => {
          const r = resolveRef(el);
          if (typeof r === "string") return { text: stripHtml(r) };
          if (isJsonRecord(r)) {
            return { text: stripHtml(r.text ?? r.name), image: r.image };
          }
          return { text: "" };
        })
        .filter((s) => s.text);
      return { name: stripHtml(resolved.name), itemListElement };
    }

    return {
      text: stripHtml(resolved.text ?? resolved.name),
      image: resolved.image,
    };
  };

  /**
   * Some details are in varying formats, for templating to be easier,
   * lets attempt to normalize them
   */
  const normalizeSchema = (node: JsonRecord): void => {
    // Copy rather than normalize the caller's node in place. Parsing a page
    // throws the source JSON away either way, but a caller who passes an
    // object it still holds (exporting a note and re-reading it, say) should
    // get its object back unchanged.
    const json = { ...node } as ParsedRecipe;
    // A page import stamps the page URL over anything the schema claims. A
    // standalone file has no page, so fall back to the recipe's own `url`.
    json.url =
      opts.sourceUrl ?? (typeof node.url === "string" ? node.url : undefined);
    normalizeImages(json);

    if (typeof node.name === "string") {
      json.name = cleanRecipeName(node.name, opts);
    }

    // Ingredients may be a string, an array of strings, or objects — flatten
    // to a clean string[] so the template renders consistently.
    const rawIngredient = node.recipeIngredient;
    if (rawIngredient != null) {
      const list: unknown[] = Array.isArray(rawIngredient)
        ? rawIngredient
        : [rawIngredient];
      json.recipeIngredient = list.map(ingredientText).filter(Boolean);
    }

    // Instructions may be a single string, a single object, or an array of
    // strings / HowToStep / HowToSection. Coerce to an array of the shapes
    // the template understands; without this a string or single object makes
    // `{{#each recipeInstructions}}` iterate characters / object keys.
    const rawInstructions = node.recipeInstructions;
    if (rawInstructions != null) {
      const list: unknown[] = Array.isArray(rawInstructions)
        ? rawInstructions
        : [rawInstructions];
      json.recipeInstructions = list
        .map(normalizeInstructionStep)
        .filter((s) => (s.itemListElement?.length ?? 0) > 0 || s.text);
    }

    json.recipeNotes = normalizeRecipeNotes(node.recipeNotes);

    // Normalize author to a plain string, resolving any `@id` references.
    const rawAuthor = node.author;
    if (rawAuthor != null) {
      if (Array.isArray(rawAuthor)) {
        json.author = (rawAuthor as unknown[])
          .map((a) => authorName(a))
          .filter(Boolean)
          .join(", ");
      } else {
        json.author = authorName(rawAuthor);
      }
    }

    recipes.push(json);
  };

  /**
   * Schemas come in every arrangement: bare arrays, `@graph` wrappers, or a
   * Recipe nested under `mainEntity` / `mainEntityOfPage` / some custom key.
   * Walk the whole tree and normalize each real Recipe node. Dedupe by
   * reference, and skip bare `@id` pointers (a Recipe ref with no content) so
   * nested recipes are found without double-counting.
   */
  const seenRecipes = new Set<JsonRecord>();
  const isRecipeNode = (value: JsonRecord): boolean => {
    const type = value["@type"];
    return Array.isArray(type) ? type.includes("Recipe") : type === "Recipe";
  };
  const collectRecipes = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectRecipes);
      return;
    }
    if (!isJsonRecord(value)) return;
    const isRealRecipe =
      isRecipeNode(value) &&
      (value.name != null ||
        value.recipeIngredient != null ||
        value.recipeInstructions != null);
    if (isRealRecipe) {
      if (!seenRecipes.has(value)) {
        seenRecipes.add(value);
        normalizeSchema(value);
      }
      return;
    }
    for (const key of Object.keys(value)) collectRecipes(value[key]);
  };

  // Index every node by `@id` first so `@id` references (e.g. an author
  // pointing at a Person node) resolve regardless of node ordering or which
  // block they live in. Then walk the blocks for Recipe entries.
  blocks.forEach((block) => indexNodes(block));
  blocks.forEach((block) => collectRecipes(block));

  return recipes;
}
