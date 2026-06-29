import { afterEach, describe, expect, it } from "vitest";

import { noticeLog } from "./helpers/obsidian-stub";
import {
  htmlResponse,
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  setRequestUrl,
} from "./helpers/plugin";

/**
 * The fetch/transport layer of fetchRecipes: URL validation, the mobile
 * fragment-stripping fix, and the optional 403 proxy fallback.
 */
describe("fetchRecipes — fetch transport", () => {
  afterEach(() => resetObsidianStub());

  const RECIPE = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Soup",
    recipeIngredient: ["water"],
  };

  const RECIPE_HTML = htmlWithJsonLd(RECIPE);

  // Proxy responses are only trusted when the HTML echoes the target host, so
  // proxy-path fixtures carry a canonical link with the requested host.
  const RECIPE_HTML_WITH_HOST = htmlWithJsonLd(
    RECIPE,
    '<link rel="canonical" href="https://example.com/recipe" />',
  );

  describe("URL validation", () => {
    it("rejects a malformed URL before any network call", async () => {
      let called = false;
      setRequestUrl(() => {
        called = true;
        return htmlResponse(RECIPE_HTML);
      });
      await expect(makePlugin().fetchRecipes("not a url")).rejects.toThrow(
        /valid recipe URL/,
      );
      expect(called).toBe(false);
    });

    it("rejects non-http(s) protocols", async () => {
      await expect(
        makePlugin().fetchRecipes("ftp://example.com/recipe"),
      ).rejects.toThrow(/http:\/\/ or https:\/\//);
    });
  });

  describe("fragment stripping", () => {
    it("never sends the #fragment to the server", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        return htmlResponse(RECIPE_HTML);
      });

      await makePlugin().fetchRecipes(
        "https://www.noracooks.com/vegan-chicken-noodle-soup/#wprm-recipe-container-8103",
      );

      expect(requested).toHaveLength(1);
      expect(requested[0]).toBe(
        "https://www.noracooks.com/vegan-chicken-noodle-soup/",
      );
      expect(requested[0]).not.toContain("#");
    });

    it("preserves the query string while dropping the fragment", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        return htmlResponse(RECIPE_HTML);
      });

      await makePlugin().fetchRecipes(
        "https://example.com/recipe?print=1#jump",
      );

      expect(requested[0]).toBe("https://example.com/recipe?print=1");
    });
  });

  describe("403 proxy fallback", () => {
    it("falls back to the first proxy when the direct fetch is blocked", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        if (opts.url.includes("r.jina.ai")) {
          return htmlResponse(RECIPE_HTML_WITH_HOST);
        }
        throw new Error("403 Forbidden"); // direct
      });

      const recipes = await makePlugin({ proxyFallback: true }).fetchRecipes(
        "https://example.com/recipe#frag",
      );

      // direct attempt first, then jina wrapping the clean (hashless) URL
      expect(requested[0]).toBe("https://example.com/recipe");
      expect(requested[1]).toBe("https://r.jina.ai/https://example.com/recipe");
      expect(recipes[0].name).toBe("Soup");
      expect(noticeLog.some((m) => /proxy/i.test(m))).toBe(true);
    });

    it("does not use a proxy when proxyFallback is disabled", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        throw new Error("403 Forbidden");
      });

      await expect(
        makePlugin({ proxyFallback: false }).fetchRecipes(
          "https://example.com/recipe",
        ),
      ).rejects.toThrow(/Could not fetch that page\./);
      expect(requested).toHaveLength(1);
    });

    it("skips a proxy whose page does not echo the target host, unwrapping allorigins JSON", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        // allorigins /get wraps the HTML in a JSON envelope
        if (opts.url.includes("allorigins.win/get")) {
          return htmlResponse(
            JSON.stringify({ contents: RECIPE_HTML_WITH_HOST }),
          );
        }
        // jina returns 200 but a page that never names the host → rejected
        if (opts.url.includes("r.jina.ai")) {
          return htmlResponse(RECIPE_HTML);
        }
        throw new Error("403 Forbidden"); // direct
      });

      const recipes = await makePlugin({ proxyFallback: true }).fetchRecipes(
        "https://example.com/recipe",
      );

      expect(recipes[0].name).toBe("Soup");
      expect(requested.some((u) => u.includes("r.jina.ai"))).toBe(true);
      expect(requested.some((u) => u.includes("allorigins.win/get"))).toBe(
        true,
      );
    });

    it("retries a flaky proxy until it succeeds", async () => {
      let jinaCalls = 0;
      setRequestUrl((opts) => {
        if (opts.url.includes("r.jina.ai")) {
          jinaCalls += 1;
          if (jinaCalls < 3) throw new Error("520 Web Server Error");
          return htmlResponse(RECIPE_HTML_WITH_HOST);
        }
        throw new Error("403 Forbidden"); // direct
      });

      const recipes = await makePlugin({ proxyFallback: true }).fetchRecipes(
        "https://example.com/recipe",
      );

      expect(jinaCalls).toBe(3);
      expect(recipes[0].name).toBe("Soup");
    });

    it("surfaces a proxy-specific error after every source and retry fails", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        throw new Error("network down");
      });

      await expect(
        makePlugin({ proxyFallback: true }).fetchRecipes(
          "https://example.com/recipe",
        ),
      ).rejects.toThrow(/even via the proxy fallbacks/);

      // direct(1) + jina(3) + allorigins get(2) + allorigins raw(2)
      expect(requested).toHaveLength(8);
      expect(requested.filter((u) => u.includes("r.jina.ai"))).toHaveLength(3);
    });
  });
});
