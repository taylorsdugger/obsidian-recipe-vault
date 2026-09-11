import { describe, expect, it } from "vitest";

import {
  cookTimeToMinutes,
  createRecipeRenderer,
  DEFAULT_TEMPLATE,
  readFrontmatter,
} from "../src/index";

/**
 * The web app derives its structured columns from the stored note, so these
 * pin the reader against what DEFAULT_TEMPLATE actually writes.
 */
describe("readFrontmatter", () => {
  it("reads the keys the default template writes", () => {
    const render = createRecipeRenderer(DEFAULT_TEMPLATE, {
      formatPhoto: (path) => path,
    });
    const md = render({
      name: "Soup",
      author: "Nora",
      url: "https://example.com/soup",
      image: "https://example.com/soup.jpg",
      recipeCategory: "Dinner",
      totalTime: "PT1H30M",
      recipeIngredient: ["water"],
    });

    const fm = readFrontmatter(md);

    expect(fm.author).toBe("Nora");
    expect(fm.url).toBe("https://example.com/soup");
    expect(fm.photo).toBe("https://example.com/soup.jpg");
    expect(fm.meal_type).toBe("Dinner");
    expect(fm.cook_time).toBe("1h 30m");
    expect(fm.times_made).toBe("0");
    expect(fm.cssclasses).toBe("recipe-note");
    // `tags:` is a `- item` list in the template, collapsed to a comma string.
    expect(fm.tags).toBe("recipe");
  });

  it("unwraps a quoted wikilink photo, the way the plugin writes local images", () => {
    const md = '---\nphoto: "[[Recipes/img/soup.jpg]]"\n---\n\n# Soup\n';

    expect(readFrontmatter(md).photo).toBe("Recipes/img/soup.jpg");
  });

  it("keeps an empty value empty", () => {
    const md = "---\nlast_made:\ntimes_made: 3\n---\n\n# Soup\n";
    const fm = readFrontmatter(md);

    expect(fm.last_made).toBe("");
    expect(fm.times_made).toBe("3");
  });

  it("returns nothing for a note with no frontmatter", () => {
    expect(readFrontmatter("# Soup\n\nno frontmatter here")).toEqual({});
    expect(readFrontmatter("---\nnever closed\n")).toEqual({});
  });
});

describe("cookTimeToMinutes", () => {
  it.each([
    ["1h 30m", 90],
    ["45m", 45],
    ["2h", 120],
    ["PT1H30M", 90],
    ["PT20M", 20],
    ["45", 45],
  ])("reads %s as %i minutes", (value, expected) => {
    expect(cookTimeToMinutes(value)).toBe(expected);
  });

  it("returns null when there is no time to read", () => {
    expect(cookTimeToMinutes("")).toBeNull();
    expect(cookTimeToMinutes(undefined)).toBeNull();
    expect(cookTimeToMinutes("a while")).toBeNull();
  });
});
