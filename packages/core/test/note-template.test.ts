import * as Handlebars from "handlebars";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPLATE,
  TEMPLATE_VERSION,
  createRecipeRenderer,
  migrateImageLink,
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

  it("percent-encodes a local body image so spaces don't cut the link (#18)", () => {
    const out = render({ ...recipe, image: "90 Anlagen/Chicken-Soup.jpg" });
    expect(out).toContain("![Chicken Soup](90%20Anlagen/Chicken-Soup.jpg)");
    // Frontmatter stays a wikilink, which handles spaces on its own.
    expect(out).toContain('photo: "[[90 Anlagen/Chicken-Soup.jpg]]"');
  });

  it("encodes emoji, quotes and parens in a local body image", () => {
    const out = render({ ...recipe, image: "🍳 Pics/Mom's-(Best)-Pie.jpg" });
    expect(out).toContain(
      "](%F0%9F%8D%B3%20Pics/Mom%27s-%28Best%29-Pie.jpg)",
    );
  });

  it("does not HTML-escape the photo frontmatter", () => {
    const local = render({ ...recipe, image: "Recipe Images/Mom's-Pie.jpg" });
    expect(local).toContain('photo: "[[Recipe Images/Mom\'s-Pie.jpg]]"');

    const remote = render({ ...recipe, image: "https://x.test/a.jpg?w=1&h=2" });
    expect(remote).toContain('photo: "https://x.test/a.jpg?w=1&h=2"');
  });

  it("escapes quotes in the photo frontmatter for YAML", () => {
    const out = render({ ...recipe, image: 'https://x.test/"a".jpg' });
    expect(out).toContain('photo: "https://x.test/\\"a\\".jpg"');
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

describe("migrateImageLink", () => {
  it("routes an old raw body image through imageLink", () => {
    const old = "# Hi\n\n![{{{name}}}]({{image}})\n\nmy custom bit\n";
    expect(migrateImageLink(old)).toBe(
      "# Hi\n\n![{{{name}}}]({{imageLink image}})\n\nmy custom bit\n",
    );
  });

  it("leaves the current default template alone", () => {
    expect(migrateImageLink(DEFAULT_TEMPLATE)).toBe(DEFAULT_TEMPLATE);
  });
});
