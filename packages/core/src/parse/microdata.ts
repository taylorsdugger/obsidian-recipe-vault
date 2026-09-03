import type * as cheerio from "cheerio";

import type { JsonRecord } from "../types";

/**
 * Fallback recipe parser for pages that express their recipe as HTML
 * microdata (schema.org `itemscope`/`itemprop` attributes) instead of a
 * JSON-LD `<script>` block — e.g. the legacy EasyRecipe card used by
 * loveandlemons.com. Returns raw Recipe-shaped records so they flow through
 * the same `collectRecipes`/`normalizeSchema` pipeline as JSON-LD nodes.
 */
export function extractMicrodataRecipes(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): JsonRecord[] {
  const recipes: JsonRecord[] = [];

  $('[itemscope][itemtype*="schema.org/Recipe"]').each((_i, root) => {
    const node: JsonRecord = { "@type": "Recipe" };
    const ingredients: string[] = [];
    const instructions: string[] = [];

    $(root)
      .find("[itemprop]")
      .each((_j, el) => {
        // Microdata scoping: only keep itemprops whose nearest enclosing
        // itemscope is THIS recipe. Skip properties owned by a nested item
        // (an author Person's `name`, an aggregateRating's `ratingValue`)
        // so they aren't misattributed to the recipe.
        if ($(el).parent().closest("[itemscope]")[0] !== root) return;

        const prop = ($(el).attr("itemprop") ?? "").trim();
        if (!prop) return;

        // Extract the property value the way the microdata spec prescribes:
        // certain elements carry it in an attribute rather than their text.
        const tag = String($(el).prop("tagName") ?? "").toLowerCase();
        const resolveUrl = (raw: string): string => {
          const v = raw.trim();
          if (!v) return "";
          try {
            return new URL(v, baseUrl).href;
          } catch {
            return v;
          }
        };
        let value: string;
        if (tag === "meta") {
          value = ($(el).attr("content") ?? "").trim();
        } else if (
          tag === "img" ||
          tag === "audio" ||
          tag === "video" ||
          tag === "source" ||
          tag === "iframe" ||
          tag === "embed" ||
          tag === "track"
        ) {
          value = resolveUrl($(el).attr("src") ?? "");
        } else if (tag === "a" || tag === "area" || tag === "link") {
          value = resolveUrl($(el).attr("href") ?? "");
        } else if (tag === "object") {
          value = resolveUrl($(el).attr("data") ?? "");
        } else if (tag === "data" || tag === "meter") {
          value =
            ($(el).attr("value") ?? "").trim() ||
            $(el).text().replace(/\s+/g, " ").trim();
        } else if (tag === "time") {
          value =
            ($(el).attr("datetime") ?? "").trim() ||
            $(el).text().replace(/\s+/g, " ").trim();
        } else {
          value = $(el).text().replace(/\s+/g, " ").trim();
        }
        if (!value) return;

        switch (prop) {
          case "recipeIngredient":
          case "ingredients":
            ingredients.push(value);
            break;
          case "recipeInstructions":
            instructions.push(value);
            break;
          default:
            // First value wins for scalar props (name, description, times).
            if (node[prop] === undefined) node[prop] = value;
        }
      });

    if (ingredients.length > 0) node.recipeIngredient = ingredients;
    if (instructions.length > 0) node.recipeInstructions = instructions;

    // Only keep it if it actually carries recipe content.
    if (
      node.name != null ||
      node.recipeIngredient != null ||
      node.recipeInstructions != null
    ) {
      recipes.push(node);
    }
  });

  return recipes;
}
