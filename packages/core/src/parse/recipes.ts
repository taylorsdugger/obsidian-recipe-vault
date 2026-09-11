import * as cheerio from "cheerio";

import type { HttpPort } from "../fetch/http";
import { fetchPageHtml, type FetchPageOptions } from "../fetch/page";
import type { ParsedRecipe } from "../types";
import { type CleanNameOptions } from "./clean-name";
import { parseRecipesFromJsonLd } from "./json-ld";
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

  // Pull every ld+json block off the page. The walk itself lives in
  // ./json-ld so a standalone .json file can reuse it.
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    const content = $(el).text()?.trim();
    try {
      blocks.push(JSON.parse(content));
    } catch {
      // Skip malformed ld+json blocks; other scripts on the page may still
      // contain a valid Recipe entry.
    }
  });

  const jsonLdOpts = { ...opts, sourceUrl: url.href };
  let recipes = parseRecipesFromJsonLd(blocks, jsonLdOpts);

  // Fallback for pages that carry the recipe as HTML microdata rather than
  // JSON-LD (e.g. the legacy EasyRecipe card on loveandlemons.com). Only run
  // it when JSON-LD yielded nothing so well-structured pages are unaffected.
  // The ld+json blocks go back in alongside the microdata so any `@id` the
  // microdata references still resolves against them.
  if (recipes.length === 0) {
    const fetchHref = new URL(url.href);
    fetchHref.hash = "";
    recipes = parseRecipesFromJsonLd(
      [...blocks, extractMicrodataRecipes($, fetchHref.href)],
      jsonLdOpts,
    );
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
