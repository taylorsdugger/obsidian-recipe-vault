import { afterEach, describe, expect, it } from "vitest";

import {
  htmlWithJsonLd,
  makePlugin,
  resetObsidianStub,
  respondWith,
} from "./helpers/plugin";

/**
 * normalizeImages collapses schema.org's many `image` shapes down to a single
 * URL string so the template and image-download path stay simple.
 */
describe("fetchRecipes — image normalization", () => {
  afterEach(() => resetObsidianStub());

  async function imageFrom(image: unknown) {
    respondWith(
      htmlWithJsonLd({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Pictured Dish",
        recipeIngredient: ["water"],
        image,
      }),
    );
    const [recipe] = await makePlugin().fetchRecipes(
      "https://example.com/recipe",
    );
    return recipe.image;
  }

  it("passes a plain string URL through unchanged", async () => {
    expect(await imageFrom("https://img.example.com/a.jpg")).toBe(
      "https://img.example.com/a.jpg",
    );
  });

  it("takes the first URL from an array of strings", async () => {
    expect(
      await imageFrom([
        "https://img.example.com/first.jpg",
        "https://img.example.com/second.jpg",
      ]),
    ).toBe("https://img.example.com/first.jpg");
  });

  it("unwraps the first ImageObject in an array to its url", async () => {
    expect(
      await imageFrom([
        { "@type": "ImageObject", url: "https://img.example.com/obj.jpg" },
      ]),
    ).toBe("https://img.example.com/obj.jpg");
  });

  it("unwraps a single top-level ImageObject to its url", async () => {
    expect(
      await imageFrom({
        "@type": "ImageObject",
        url: "https://img.example.com/solo.jpg",
      }),
    ).toBe("https://img.example.com/solo.jpg");
  });
});
