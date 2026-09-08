import { describe, expect, it } from "vitest";

import { readFrontmatter, setFrontmatterValues } from "../src/index";

/**
 * The web app writes notes back into the synced vault, so a change has to
 * leave everything it didn't touch exactly as Obsidian wrote it.
 */
describe("setFrontmatterValues", () => {
  const NOTE = [
    "---",
    "tags:",
    "  - recipe",
    "date_added: 2026-02-22 09:11",
    "meal_type: Dessert",
    "times_made: 2",
    "last_made: 2026-07-16",
    'cook_time: "50m "',
    "---",
    "",
    "# [Banana Bread](https://example.com)",
    "",
    "### Ingredients",
    "",
    "- [ ] 2 bananas",
    "",
  ].join("\n");

  it("rewrites a key in place and leaves the rest alone", () => {
    const out = setFrontmatterValues(NOTE, { times_made: 3 });

    expect(out).toContain("times_made: 3");
    expect(out).not.toContain("times_made: 2");
    // Every other line survives, including the list and the quoted value.
    expect(out).toContain("tags:\n  - recipe");
    expect(out).toContain('cook_time: "50m "');
    expect(out).toContain("- [ ] 2 bananas");
    // Key order is untouched.
    expect(out.indexOf("meal_type")).toBeLessThan(out.indexOf("times_made"));
  });

  it("appends a key the note doesn't have yet", () => {
    const out = setFrontmatterValues(NOTE, { source: "web" });

    expect(readFrontmatter(out).source).toBe("web");
    expect(readFrontmatter(out).meal_type).toBe("Dessert");
  });

  it("clears a value but keeps the key", () => {
    const out = setFrontmatterValues(NOTE, { last_made: null });

    expect(out).toContain("last_made:\n");
    expect(readFrontmatter(out).last_made).toBe("");
  });

  it("quotes a value that would otherwise break the YAML", () => {
    const out = setFrontmatterValues(NOTE, { cook_time: "1h 30m " });

    expect(out).toContain('cook_time: "1h 30m "');
    expect(readFrontmatter(out).cook_time).toBe("1h 30m");
  });

  it("sets several keys at once", () => {
    const out = setFrontmatterValues(NOTE, {
      times_made: 4,
      last_made: "2026-09-08",
    });
    const fm = readFrontmatter(out);

    expect(fm.times_made).toBe("4");
    expect(fm.last_made).toBe("2026-09-08");
  });

  it("leaves a note with no frontmatter alone", () => {
    const plain = "# Soup\n\nno frontmatter\n";
    expect(setFrontmatterValues(plain, { times_made: 1 })).toBe(plain);
  });
});
