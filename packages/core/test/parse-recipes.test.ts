import { describe, expect, it } from "vitest";

import {
  fetchRecipes,
  parseRecipesFromHtml,
  type FetchOptions,
  type HttpPort,
  type ParseOptions,
} from "../src/index";

/**
 * The plugin's `test/fetch-recipes.*` suite is the behaviour guard for the
 * parser itself. These cover the two seams core adds on top of it: parsing
 * HTML that came from anywhere with no network at all, and driving the fetch
 * path through an `HttpPort` instead of Obsidian's `requestUrl`.
 */

const OPTS: ParseOptions = {
  fillerWordsMode: "auto",
  customFillerWords: "",
  filterVeganWords: true,
  filterGlutenFreeWords: true,
};

const RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Easy Vegan Soup",
  recipeIngredient: ["1 cup water", "2 carrots"],
  recipeInstructions: ["Boil the water.", "Add carrots."],
};

function htmlWithJsonLd(value: unknown, extraBody = ""): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
    value,
  )}</script></head><body>${extraBody}</body></html>`;
}

describe("parseRecipesFromHtml", () => {
  const url = new URL("https://example.com/recipe");

  it("parses a JSON-LD recipe with no network involved", () => {
    const recipes = parseRecipesFromHtml(htmlWithJsonLd(RECIPE), url, OPTS);

    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe("Soup");
    expect(recipes[0].recipeIngredient).toEqual(["1 cup water", "2 carrots"]);
    expect(recipes[0].recipeInstructions).toEqual([
      { text: "Boil the water.", image: undefined },
      { text: "Add carrots.", image: undefined },
    ]);
  });

  it("stamps the source url, fragment included", () => {
    const hashed = new URL(
      "https://example.com/recipe#wprm-recipe-container-1",
    );
    const recipes = parseRecipesFromHtml(htmlWithJsonLd(RECIPE), hashed, OPTS);

    expect(recipes[0].url).toBe(hashed.href);
  });

  it("keeps filler words when the filters are off", () => {
    const recipes = parseRecipesFromHtml(htmlWithJsonLd(RECIPE), url, {
      ...OPTS,
      fillerWordsMode: "custom",
      customFillerWords: "",
      filterVeganWords: false,
      filterGlutenFreeWords: false,
    });

    expect(recipes[0].name).toBe("Easy Vegan Soup");
  });

  it("returns an empty list for a page with no recipe", () => {
    const recipes = parseRecipesFromHtml(
      "<!doctype html><html><body><p>no recipe here</p></body></html>",
      url,
      OPTS,
    );

    expect(recipes).toEqual([]);
  });

  it("falls back to WPRM markup for notes missing from the schema", () => {
    const html = htmlWithJsonLd(
      RECIPE,
      '<div class="wprm-recipe-notes">Notes: Keeps for three days.</div>',
    );

    const recipes = parseRecipesFromHtml(html, url, OPTS);

    expect(recipes[0].recipeNotes).toEqual(["Keeps for three days."]);
  });
});

describe("doubled parentheses from WP Recipe Maker", () => {
  const url = new URL("https://example.com/recipe");

  /*
   * Not a hypothetical: these two strings are verbatim from
   * minimalistbaker.com's own ld+json. WPRM wraps its ingredient-notes field
   * in parentheses, so a note that already has its own comes out doubled.
   */
  it("collapses them on the way into an ingredient", () => {
    const html = htmlWithJsonLd({
      ...RECIPE,
      recipeIngredient: [
        "1 medium shallot ((minced))",
        "1 \u00bd Tbsp coconut oil ((or avocado or grape seed oil // sub water if avoiding oil))",
      ],
    });

    expect(parseRecipesFromHtml(html, url, OPTS)[0].recipeIngredient).toEqual([
      "1 medium shallot (minced)",
      "1 \u00bd Tbsp coconut oil (or avocado or grape seed oil // sub water if avoiding oil)",
    ]);
  });

  it("leaves a single group and a real bracketed size alone", () => {
    const html = htmlWithJsonLd({
      ...RECIPE,
      recipeIngredient: [
        "2 (14-ounce) cans coconut milk",
        "2 cloves garlic (minced)",
      ],
    });

    expect(parseRecipesFromHtml(html, url, OPTS)[0].recipeIngredient).toEqual([
      "2 (14-ounce) cans coconut milk",
      "2 cloves garlic (minced)",
    ]);
  });
});

describe("fetchRecipes", () => {
  const FETCH_OPTS: FetchOptions = {
    ...OPTS,
    proxyFallback: false,
    retryDelayMs: 0,
  };

  /** An HttpPort that answers every request with the same body. */
  function portReturning(body: string, seen: string[] = []): HttpPort {
    return {
      get: async (url) => {
        seen.push(url);
        return { status: 200, text: body };
      },
    };
  }

  it("fetches through the port and parses the result", async () => {
    const seen: string[] = [];
    const recipes = await fetchRecipes(
      "https://example.com/recipe#frag",
      portReturning(htmlWithJsonLd(RECIPE), seen),
      FETCH_OPTS,
    );

    // The fragment is client-side only and must never reach the server.
    expect(seen).toEqual(["https://example.com/recipe"]);
    expect(recipes[0].name).toBe("Soup");
  });

  it("rejects a URL that isn't http(s) before touching the port", async () => {
    let called = false;
    const port: HttpPort = {
      get: async () => {
        called = true;
        return { status: 200, text: "" };
      },
    };

    await expect(
      fetchRecipes("ftp://example.com/recipe", port, FETCH_OPTS),
    ).rejects.toThrow(/must start with http/);
    expect(called).toBe(false);
  });

  it("reports progress instead of showing a Notice itself", async () => {
    const messages: string[] = [];
    await fetchRecipes(
      "https://example.com/recipe",
      portReturning(htmlWithJsonLd(RECIPE)),
      { ...FETCH_OPTS, onProgress: (m) => messages.push(m) },
    );

    expect(messages[0]).toBe("Fetching: https://example.com/recipe");
  });
});
