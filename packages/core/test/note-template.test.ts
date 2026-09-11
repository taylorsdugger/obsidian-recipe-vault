import * as Handlebars from "handlebars";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPLATE,
  TEMPLATE_VERSION,
  createRecipeRenderer,
} from "../src";

const recipe = {
  name: "Chicken Soup",
  url: "https://x.test/soup",
  image: "https://x.test/soup.jpg",
  author: "Nora",
  totalTime: "PT1H30M",
  recipeCategory: "Dinner",
  datePublished: "2024-03-01T10:00:00Z",
  description: "Cozy.",
  recipeIngredient: ["2 cups stock", "1 onion"],
  recipeInstructions: [
    { text: "Simmer." },
    { name: "Serve", itemListElement: [{ text: "Ladle." }] },
  ],
  recipeNotes: ["Freezes well."],
};

describe("createRecipeRenderer with DEFAULT_TEMPLATE", () => {
  const render = createRecipeRenderer(DEFAULT_TEMPLATE);
  const md = render(recipe);

  it("renders frontmatter through the helpers", () => {
    expect(md).toContain("cook_time: 1h 30m");
    expect(md).toContain('photo: "https://x.test/soup.jpg"');
    expect(md).toContain("created: 2024-03-01");
    expect(md).toMatch(/date_added: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(md).toContain("author: Nora");
    expect(md).toContain("meal_type: Dinner");
  });

  it("renders the body sections", () => {
    expect(md).toContain("# [Chicken Soup](https://x.test/soup)");
    expect(md).toContain("![Chicken Soup](https://x.test/soup.jpg)");
    expect(md).toContain("- [ ] 2 cups stock\n- [ ] 1 onion");
    expect(md).toContain("- Simmer.");
    expect(md).toContain("#### Serve\n- Ladle.");
    expect(md).toContain("## Notes\n- Freezes well.");
  });

  it("wikilinks a local image path", () => {
    const out = render({ ...recipe, image: "img/soup.jpg" });
    expect(out).toContain('photo: "[[img/soup.jpg]]"');
  });

  it("does not register helpers on the global Handlebars", () => {
    expect((Handlebars as any).helpers.magicTime).toBeUndefined();
    expect((Handlebars as any).helpers.photoFrontmatter).toBeUndefined();
  });

  it("honours a custom photo formatter", () => {
    const custom = createRecipeRenderer(DEFAULT_TEMPLATE, {
      formatPhoto: (p) => `url:${p}`,
    });
    expect(custom({ ...recipe, image: "a.jpg" })).toContain(
      'photo: "url:a.jpg"',
    );
  });
});

describe("helpers", () => {
  it("splitTags turns a comma list into YAML items", () => {
    const r = createRecipeRenderer("{{splitTags keywords}}");
    expect(r({ keywords: "easy, soup" })).toBe("- easy\n- soup\n");
    expect(r({ keywords: 3 })).toBe("");
  });

  it("magicTime handles the three call shapes", () => {
    expect(createRecipeRenderer("{{magicTime}}")({})).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect(createRecipeRenderer("{{magicTime t}}")({ t: "PT45M" })).toBe(
      "45m ",
    );
    expect(
      createRecipeRenderer("{{magicTime t 'yyyy'}}")({ t: "2024-03-01" }),
    ).toBe("2024");
    expect(createRecipeRenderer("{{magicTime t}}")({})).toBe("");
  });
});

it("exposes the template version", () => {
  expect(TEMPLATE_VERSION).toBe(2);
});
