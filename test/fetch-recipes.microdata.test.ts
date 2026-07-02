import { afterEach, describe, expect, it } from "vitest";

import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
} from "./helpers/plugin";

/**
 * Fallback parser for pages that carry the recipe as HTML microdata
 * (schema.org `itemscope`/`itemprop`) instead of JSON-LD — e.g. the legacy
 * EasyRecipe card on loveandlemons.com. Mirrors that real markup, including
 * nested `author`/`aggregateRating` items whose own props must not leak onto
 * the recipe.
 */
describe("fetchRecipes — HTML microdata fallback", () => {
  const URL = "https://www.loveandlemons.com/basil-zucchini-soup/";

  afterEach(() => resetObsidianStub());

  const MICRODATA_HTML = `<!doctype html><html><body>
    <div class="easyrecipe" itemscope itemtype="http://schema.org/Recipe">
      <meta itemprop="keywords" content="zucchini soup, spring, summer">
      <div itemprop="aggregateRating" itemscope
           itemtype="http://schema.org/AggregateRating">
        <span itemprop="ratingValue">4.6</span>
        <span itemprop="ratingCount">31</span>
      </div>
      <h2 itemprop="name">Basil Zucchini Soup</h2>
      <img itemprop="image" src="/img/soup.jpg" width="205">
      <time itemprop="totalTime" datetime="PT26M">26 mins</time>
      <div itemprop="description">A fresh herb and veggie soup.</div>
      <span itemprop="author" itemscope itemtype="http://schema.org/Person">
        <span itemprop="name">Jeanine Donofrio</span>
      </span>
      <span itemprop="recipeYield">4 as a starter/side</span>
      <ul>
        <li class="ingredient" itemprop="recipeIngredient">⅔ cup sliced leeks</li>
        <li class="ingredient" itemprop="recipeIngredient">1 garlic clove, chopped</li>
        <li class="ingredient" itemprop="recipeIngredient">½ tablespoon miso paste</li>
      </ul>
      <ol>
        <li class="instruction" itemprop="recipeInstructions">Slice the leeks.</li>
        <li class="instruction" itemprop="recipeInstructions">Sauté until soft.</li>
        <li class="instruction" itemprop="recipeInstructions">Blend everything.</li>
      </ol>
    </div>
  </body></html>`;

  async function parse(html: string) {
    respondWith(html);
    return makePlugin().fetchRecipes(URL);
  }

  it("parses a recipe expressed only as microdata", async () => {
    const recipes = await parse(MICRODATA_HTML);
    expect(recipes).toHaveLength(1);

    const recipe = recipes[0] as any;
    expect(recipe.name).toBe("Basil Zucchini Soup");
    expect(recipe.recipeIngredient).toEqual([
      "⅔ cup sliced leeks",
      "1 garlic clove, chopped",
      "½ tablespoon miso paste",
    ]);
    expect(recipe.recipeInstructions.map((s: any) => s.text)).toEqual([
      "Slice the leeks.",
      "Sauté until soft.",
      "Blend everything.",
    ]);
  });

  it("respects nested itemscopes — author and rating do not leak", async () => {
    const [recipe] = (await parse(MICRODATA_HTML)) as any[];
    // author is its own Person item; its `name` must be the author, and the
    // recipe `name` must stay the recipe title (not overwritten by the Person).
    expect(recipe.name).toBe("Basil Zucchini Soup");
    expect(recipe.author).toBe("Jeanine Donofrio");
    // aggregateRating's ratingValue/ratingCount belong to the nested item.
    expect(recipe.ratingValue).toBeUndefined();
    expect(recipe.ratingCount).toBeUndefined();
  });

  it("reads values from the spec-defined attributes, resolving relative URLs", async () => {
    const [recipe] = (await parse(MICRODATA_HTML)) as any[];
    // <img src> resolved against the page URL, <time datetime>, <meta content>.
    expect(recipe.image).toBe("https://www.loveandlemons.com/img/soup.jpg");
    expect(recipe.totalTime).toBe("PT26M");
    expect(recipe.keywords).toBe("zucchini soup, spring, summer");
  });

  it("does not run when JSON-LD already yielded a recipe", async () => {
    // Page has BOTH a valid JSON-LD recipe and a stray microdata block; the
    // JSON-LD wins and the microdata fallback is skipped (no duplicate).
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Ratatouille",
      recipeIngredient: ["water"],
    };
    const html = htmlWithJsonLd(
      jsonLd,
      `<div itemscope itemtype="http://schema.org/Recipe">
         <h2 itemprop="name">Gazpacho</h2>
       </div>`,
    );
    const recipes = (await parse(html)) as any[];
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe("Ratatouille");
  });
});
