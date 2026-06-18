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

  const RECIPE_HTML = htmlWithJsonLd({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Soup",
    recipeIngredient: ["water"],
  });

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
    it("retries through the proxy when the direct fetch throws", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        if (requested.length === 1) {
          throw new Error("403 Forbidden");
        }
        return htmlResponse(RECIPE_HTML);
      });

      const recipes = await makePlugin({ proxyFallback: true }).fetchRecipes(
        "https://example.com/recipe#frag",
      );

      // direct attempt first, then the proxy wrapping the clean (hashless) URL
      expect(requested).toHaveLength(2);
      expect(requested[0]).toBe("https://example.com/recipe");
      expect(requested[1]).toBe(
        "https://api.allorigins.win/raw?url=" +
          encodeURIComponent("https://example.com/recipe"),
      );
      expect(recipes[0].name).toBe("Soup");
      expect(noticeLog.some((m) => /proxy/i.test(m))).toBe(true);
    });

    it("does not retry when proxyFallback is disabled", async () => {
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

    it("surfaces a proxy-specific error when the proxy also fails", async () => {
      const requested: string[] = [];
      setRequestUrl((opts) => {
        requested.push(opts.url);
        throw new Error("network down");
      });

      await expect(
        makePlugin({ proxyFallback: true }).fetchRecipes(
          "https://example.com/recipe",
        ),
      ).rejects.toThrow(/even via the proxy fallback/);
      expect(requested).toHaveLength(2);
    });
  });
});
