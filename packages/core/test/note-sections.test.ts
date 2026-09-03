import { describe, expect, it } from "vitest";

import {
  ensureRecipeNotesSection,
  ensureRequiredRecipeFrontmatter,
  findMarkdownSection,
  formatIsoDuration,
  formatPhotoValue,
  ingredientsFromBody,
  isRecipeNotesSectionEmpty,
  parseRecipeSections,
  parseSectionList,
  replaceRecipeSections,
} from "../src";

const NOTE = [
  "---",
  "cssclasses: recipe-note",
  "---",
  "",
  "# Soup",
  "",
  "### Ingredients",
  "",
  "- [ ] 2 cups stock",
  "- [x] 1 onion, diced",
  "",
  "### Instructions",
  "",
  "- Simmer.",
  "2. Serve.",
  "",
  "## Notes",
  "",
].join("\n");

describe("findMarkdownSection", () => {
  it("finds a heading at any level, case-insensitively", () => {
    const range = findMarkdownSection(NOTE, "ingredients");
    expect(range).not.toBeNull();
    expect(NOTE.slice(range!.bodyStart, range!.bodyEnd)).toContain(
      "2 cups stock",
    );
  });

  it("stops the body at the next heading of any level", () => {
    const range = findMarkdownSection(NOTE, "Ingredients")!;
    expect(NOTE.slice(range.bodyStart, range.bodyEnd)).not.toContain(
      "Instructions",
    );
  });

  it("returns null when the heading is missing", () => {
    expect(findMarkdownSection(NOTE, "Equipment")).toBeNull();
  });

  it("escapes regex characters in the title", () => {
    expect(
      findMarkdownSection("## What (else)?\nbody", "What (else)?"),
    ).not.toBeNull();
  });
});

describe("parseSectionList", () => {
  it("strips checkboxes from ingredient lines", () => {
    expect(
      parseSectionList("- [ ] flour\n- [x] sugar\n- salt\n\n", true),
    ).toEqual(["flour", "sugar", "salt"]);
  });

  it("strips bullets and numbers from instruction lines", () => {
    expect(parseSectionList("- Mix.\n* Bake.\n3. Cool.", false)).toEqual([
      "Mix.",
      "Bake.",
      "Cool.",
    ]);
  });
});

describe("parseRecipeSections / replaceRecipeSections", () => {
  it("reads both sections", () => {
    const parsed = parseRecipeSections(NOTE)!;
    expect(parsed.recipeIngredient).toEqual(["2 cups stock", "1 onion, diced"]);
    expect(parsed.recipeInstructions).toEqual(["Simmer.", "Serve."]);
  });

  it("returns null when a section is missing", () => {
    expect(parseRecipeSections("### Ingredients\n- x")).toBeNull();
  });

  it("rewrites both bodies and leaves the rest alone", () => {
    const next = replaceRecipeSections(NOTE, ["3 cups stock"], ["Boil."]);
    expect(next).toContain("- [ ] 3 cups stock");
    expect(next).toContain("- Boil.");
    expect(next).not.toContain("onion");
    expect(next).toContain("# Soup");
    expect(next).toContain("## Notes");
    expect(parseRecipeSections(next)).toMatchObject({
      recipeIngredient: ["3 cups stock"],
      recipeInstructions: ["Boil."],
    });
  });

  it("throws when a section is missing", () => {
    expect(() => replaceRecipeSections("# Nope", [], [])).toThrow(
      /Ingredients and Instructions/,
    );
  });
});

describe("ingredientsFromBody", () => {
  it("returns the ingredient lines, or nothing without the section", () => {
    expect(ingredientsFromBody(NOTE)).toEqual([
      "2 cups stock",
      "1 onion, diced",
    ]);
    expect(ingredientsFromBody("# Soup")).toEqual([]);
  });
});

describe("formatPhotoValue / formatIsoDuration", () => {
  it("wikilinks local paths and passes URLs through", () => {
    expect(formatPhotoValue("img/soup.jpg")).toBe("[[img/soup.jpg]]");
    expect(formatPhotoValue("https://x.test/a.jpg")).toBe(
      "https://x.test/a.jpg",
    );
  });

  it("formats ISO durations and leaves other strings alone", () => {
    expect(formatIsoDuration("PT1H30M")).toBe("1h 30m ");
    expect(formatIsoDuration("45 minutes")).toBe("45 minutes");
  });
});

describe("ensureRequiredRecipeFrontmatter", () => {
  it("adds missing keys to existing frontmatter", () => {
    const md = "---\ntags:\n- recipe\n---\n\n# Soup\n";
    const out = ensureRequiredRecipeFrontmatter(md, {
      cookTime: "PT20M",
      image: "https://x.test/a.jpg",
    });
    expect(out).toBe(
      '---\ntags:\n- recipe\ncssclasses: recipe-note\ncook_time: 20m \nphoto: "https://x.test/a.jpg"\n---\n\n# Soup\n',
    );
  });

  it("returns the note unchanged when every key is present", () => {
    const md =
      '---\ncssclasses: recipe-note\ncook_time: 5m\nphoto: ""\n---\n# Soup\n';
    expect(ensureRequiredRecipeFrontmatter(md, {})).toBe(md);
  });

  it("prepends a frontmatter block when there is none", () => {
    expect(ensureRequiredRecipeFrontmatter("# Soup\n", {})).toBe(
      '---\ncssclasses: recipe-note\ncook_time: \nphoto: ""\n---\n\n# Soup\n',
    );
  });

  it("uses the injected photo formatter and escapes quotes", () => {
    const out = ensureRequiredRecipeFrontmatter(
      "# Soup\n",
      { image: 'a"b.jpg' },
      { formatPhoto: (p) => `url:${p}` },
    );
    expect(out).toContain('photo: "url:a\\"b.jpg"');
  });
});

describe("notes section", () => {
  it("reports an empty or missing Notes section", () => {
    expect(isRecipeNotesSectionEmpty(NOTE)).toBe(true);
    expect(isRecipeNotesSectionEmpty("# Soup")).toBe(true);
    expect(isRecipeNotesSectionEmpty("## Notes\n\n- tip\n")).toBe(false);
  });

  // The heading match consumes the newline after `## Notes`, so filling adds
  // two more and an extra blank line lands above the notes. Pinned as the
  // behaviour the plugin has always had; fix on both sides if it changes.
  it("fills an empty Notes section", () => {
    const out = ensureRecipeNotesSection(NOTE, ["Freeze well."]);
    expect(out.endsWith("## Notes\n\n\n- Freeze well.\n")).toBe(true);
  });

  it("appends a Notes section when the heading is missing", () => {
    expect(ensureRecipeNotesSection("# Soup\n", ["a", "b"])).toBe(
      "# Soup\n\n## Notes\n\n- a\n- b\n",
    );
  });

  it("leaves a non-empty section and empty input alone", () => {
    const md = "## Notes\n\n- keep\n";
    expect(ensureRecipeNotesSection(md, ["new"])).toBe(md);
    expect(ensureRecipeNotesSection(NOTE, [])).toBe(NOTE);
  });

  it("keeps a following section when filling", () => {
    const md = "## Notes\n\n## Source\n\nx\n";
    expect(ensureRecipeNotesSection(md, ["tip"])).toBe(
      "## Notes\n\n\n- tip\n\n## Source\n\nx\n",
    );
  });
});
