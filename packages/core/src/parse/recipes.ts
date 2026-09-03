import * as cheerio from "cheerio";

import type { HttpPort } from "../fetch/http";
import { fetchPageHtml, type FetchPageOptions } from "../fetch/page";
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
import { extractMicrodataRecipes } from "./microdata";
import { extractWprmRecipeNotes, normalizeRecipeNotes } from "./notes";

/** Everything the pure parse step reads. No vault, no network. */
export type ParseOptions = CleanNameOptions;

/** Parse options plus the transport settings {@link fetchPageHtml} needs. */
export interface FetchOptions extends ParseOptions, FetchPageOptions {}

/**
 * Parse every schema.org Recipe out of a page's HTML and normalize it for
 * templating. `url` is the original URL including any fragment — the WPRM
 * notes fallback uses the fragment to pick the right recipe card.
 */
export function parseRecipesFromHtml(
  html: string,
  url: URL,
  opts: ParseOptions,
): ParsedRecipe[] {
  const $ = cheerio.load(html, {});

  /**
   * the main recipes list, we'll use to render from
   * its an array instead because a page can technically have multiple recipes on it
   */
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
    const json = node as ParsedRecipe;
    json.url = url.href;
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

  // parse the dom of the page and look for any schema.org/Recipe
  const parsedBlocks: unknown[][] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    const content = $(el).text()?.trim();
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      // Skip malformed ld+json blocks; other scripts on the page may still
      // contain a valid Recipe entry.
      return;
    }

    // to make things consistent, we'll put all recipes into an array
    const data = Array.isArray(json) ? (json as unknown[]) : [json];
    parsedBlocks.push(data);
  });

  // Index every node by `@id` first so `@id` references (e.g. an author
  // pointing at a Person node) resolve regardless of node ordering or which
  // script block they live in. Then walk the blocks for Recipe entries.
  parsedBlocks.forEach((data) => indexNodes(data));
  parsedBlocks.forEach((data) => collectRecipes(data));

  // Fallback for pages that carry the recipe as HTML microdata rather than
  // JSON-LD (e.g. the legacy EasyRecipe card on loveandlemons.com). Only run
  // it when JSON-LD yielded nothing so well-structured pages are unaffected.
  if (recipes.length === 0) {
    const fetchHref = new URL(url.href);
    fetchHref.hash = "";
    collectRecipes(extractMicrodataRecipes($, fetchHref.href));
  }

  // Fallback for WordPress Recipe Maker pages where notes may not be in JSON-LD.
  const fallbackNotes = extractWprmRecipeNotes($, url.hash);
  if (fallbackNotes.length > 0) {
    const hasNotesInSchema = recipes.some(
      (recipe) => normalizeRecipeNotes(recipe.recipeNotes).length > 0,
    );
    if (!hasNotesInSchema && recipes[0]) {
      recipes[0].recipeNotes = fallbackNotes;
    }
  }

  return recipes;
}

/**
 * The main function to go get the recipe, and format it for the template
 */
export async function fetchRecipes(
  rawUrl: string,
  http: HttpPort,
  opts: FetchOptions,
): Promise<ParsedRecipe[]> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid recipe URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Recipe URL must start with http:// or https://.");
  }

  // A URL fragment (`#wprm-recipe-container-…`) is client-side only and must
  // never be sent to the server. Desktop's network stack strips it
  // automatically, but Obsidian's mobile (Capacitor) `requestUrl` forwards
  // the fragment to the native HTTP client, which hosts reject (403/404) —
  // breaking "jump to recipe" imports on Android while they work on desktop.
  // Keep `url` (with the hash) for extractWprmRecipeNotes below; fetch clean.
  const fetchUrl = new URL(url.href);
  fetchUrl.hash = "";

  const html = await fetchPageHtml(fetchUrl, http, opts);

  return parseRecipesFromHtml(html, url, opts);
}
