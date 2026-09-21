import { describe, expect, it } from "vitest";
import { itemFromLine } from "@recipe-vault/core";
import { removeCheckedItems } from "@recipe-vault/core/shopping/markdown";

import {
  aisleOf,
  applyMerge,
  bareText,
  linesOf,
  removeLine,
  setChecked,
  setText,
  sortListLines,
  tidyList,
  withAmount,
  type ShoppingNote,
} from "../src/worker/shopping-store";

/** A note as `readList` would hand it over. */
function noteOf(markdown: string): ShoppingNote {
  return { markdown, etag: "etag", lines: linesOf(markdown) };
}

/**
 * The whole point of editing lines instead of re-rendering the note: the cook
 * writes things in Obsidian that the parser can't reproduce, and the app must
 * not quietly rewrite them.
 */
describe("shopping note edits", () => {
  const HAND_WRITTEN = [
    "# Shopping List",
    "",
    "Costco run, not the corner shop.",
    "",
    "- [ ] 1 onion, diced",
    "- [x] zucchini flowers",
    "- [ ] 2 cups flour *(Banana Bread)*",
    "",
  ].join("\n");

  it("reads items in file order and finds their lines", () => {
    const lines = linesOf(HAND_WRITTEN);
    // Names come back as the normalized merge key, so they are singular.
    expect(lines.map((l) => l.item.name)).toEqual([
      "onion",
      "zucchini flower",
      "flour",
    ]);
    expect(lines.map((l) => l.lineIndex)).toEqual([4, 5, 6]);
    // The checkbox state comes off the line, not from anywhere else.
    expect(lines.map((l) => l.item.checked)).toEqual([false, true, false]);
    // `*(Banana Bread)*` round-trips back into sources.
    expect(lines[2].item.sources).toEqual(["Banana Bread"]);
  });

  it("toggling a box leaves the rest of the line alone", () => {
    // ", diced" is dropped by the parser, so a re-render would lose it. The
    // line edit keeps the text byte for byte.
    const next = setChecked(HAND_WRITTEN, 4, true);
    expect(next.split("\n")[4]).toBe("- [x] 1 onion, diced");
    expect(next.split("\n")[2]).toBe("Costco run, not the corner shop.");
    expect(next.split("\n").length).toBe(HAND_WRITTEN.split("\n").length);
  });

  it("unchecking is the same edit in reverse", () => {
    expect(setChecked(HAND_WRITTEN, 5, false).split("\n")[5]).toBe(
      "- [ ] zucchini flowers",
    );
  });

  it("ignores a line index that isn't an item", () => {
    // The header. A stale index from the other phone must not corrupt the note.
    expect(setChecked(HAND_WRITTEN, 0, true)).toBe(HAND_WRITTEN);
    expect(setChecked(HAND_WRITTEN, 99, true)).toBe(HAND_WRITTEN);
  });

  it("merges into the matching line and sorts the rest into their aisle", () => {
    const result = applyMerge(noteOf(HAND_WRITTEN), [
      itemFromLine("1 cup flour", "Pancakes"),
      itemFromLine("3 lemons", "Pancakes"),
    ]);

    expect(result.merged).toBe(1);
    expect(result.added).toBe(1);

    const lines = result.markdown.split("\n");
    // Produce first, then baking - the lemons land with the onion rather than
    // on the end, and the flour drops below both.
    expect(lines.slice(4, 8)).toEqual([
      "- [ ] 3 lemons *(Pancakes)*",
      "- [ ] 1 onion, diced",
      "- [x] zucchini flowers",
      "- [ ] 3 cups flour *(Banana Bread, Pancakes)*",
    ]);
    // The header stays where it was, above the items.
    expect(lines[2]).toBe("Costco run, not the corner shop.");
  });

  it("sorting moves lines without rewriting them", () => {
    // The whole reason sorting is a permutation and not a re-render: ", diced"
    // and "zucchini flowers" are the cook's words, and a parse-and-render
    // round trip would hand back "1 onion" and "zucchini flower".
    const sorted = sortListLines(
      [
        "# Shopping List",
        "- [ ] 2 cups flour *(Banana Bread)*",
        "- [ ] 1 onion, diced",
        "- [x] zucchini flowers",
        "",
      ].join("\n"),
    );

    expect(sorted?.split("\n").slice(1, 4)).toEqual([
      "- [ ] 1 onion, diced",
      "- [x] zucchini flowers",
      "- [ ] 2 cups flour *(Banana Bread)*",
    ]);
  });

  it("says nothing to do when the list is already in order", () => {
    expect(sortListLines(HAND_WRITTEN)).toBeNull();
  });

  /**
   * A list built before the names were normalized has rows that now answer to
   * the same name. That is worse than untidy: the row id *is* the name, so the
   * second row's checkbox ticks the first row's line.
   */
  describe("tidying a list that already has the duplicates", () => {
    const MESSY = [
      "# Shopping List",
      "",
      "- [ ] 1 large onion",
      "- [ ] 2 cups flour *(Bread)*",
      "- [ ] 2 yellow onions, diced",
      "- [x] 1 cup flour *(Cake)*",
      "- [ ] 3 carrots",
      "",
    ].join("\n");

    it("combines the rows that are the same row, then sorts", () => {
      const result = tidyList(MESSY);
      expect(result?.combined).toBe(2);

      const lines = result!.content.split("\n");
      expect(lines.slice(2, 5)).toEqual([
        "- [ ] 3 carrots",
        "- [ ] 3 onions (large, yellow, diced)",
        "- [ ] 3 cups flour *(Bread, Cake)*",
      ]);
      // Two lines fewer, and the header didn't move.
      expect(lines[0]).toBe("# Shopping List");
      expect(
        result!.content.split("\n").filter((l) => l.startsWith("- [")),
      ).toHaveLength(3);
    });

    it("leaves a combined row wanted if any part of it still was", () => {
      // One cup of flour was in the basket and two weren't. You still need flour.
      const flour = tidyList(MESSY)!
        .content.split("\n")
        .find((line) => line.includes("flour"));
      expect(flour?.startsWith("- [ ]")).toBe(true);
    });

    it("leaves a line whose name is unique exactly as written", () => {
      // "3 carrots" had no duplicate, so it is the original string, not a
      // re-render - which is what keeps a prep note typed in Obsidian.
      const note = [
        "- [ ] 1 onion, finely diced by hand",
        "- [ ] 2 cups flour",
        "- [ ] 1 cup flour",
        "",
      ].join("\n");
      expect(tidyList(note)!.content).toContain(
        "- [ ] 1 onion, finely diced by hand",
      );
    });

    it("says nothing to do when the list is already tidy", () => {
      expect(tidyList(HAND_WRITTEN)).toBeNull();
    });

    it("sorts without combining when there is nothing to combine", () => {
      const result = tidyList(
        ["- [ ] 2 cups flour", "- [ ] 1 onion", ""].join("\n"),
      );
      expect(result?.combined).toBe(0);
      expect(result?.content.split("\n").slice(0, 2)).toEqual([
        "- [ ] 1 onion",
        "- [ ] 2 cups flour",
      ]);
    });
  });

  it("puts things in the aisle they are actually in", () => {
    const aisle = (line: string) => aisleOf(itemFromLine(line, ""));
    expect(aisle("2 yellow onions")).toBe("produce");
    expect(aisle("1 lb ground beef")).toBe("meat");
    // "chicken broth" is a can, not the meat counter, even though a meat
    // names it.
    expect(aisle("4 cups chicken broth")).toBe("canned");
    expect(aisle("1 tsp kosher salt")).toBe("spices");
    expect(aisle("2 tbsp extra-virgin olive oil")).toBe("condiments");
    // Nothing in the dictionary. Sorts last rather than guessing.
    expect(aisle("1 packet dinosaur-shaped whatsits")).toBe("other");
  });

  it("builds a note from nothing when the vault has no list yet", () => {
    const result = applyMerge(noteOf(""), [itemFromLine("2 lemons", "")]);
    expect(result.added).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.markdown).toContain("- [ ] 2 lemons");
    // No source annotation when there's no recipe behind it.
    expect(result.markdown).not.toContain("*()*");
  });

  it("clear-checked drops only checked lines", () => {
    const { content, removed } = removeCheckedItems(HAND_WRITTEN);
    expect(removed).toBe(1);
    expect(content).not.toContain("zucchini flowers");
    expect(content).toContain("- [ ] 1 onion, diced");
    expect(content).toContain("Costco run, not the corner shop.");
  });

  it("removing one line leaves its neighbours in place", () => {
    const next = removeLine(HAND_WRITTEN, 5);
    expect(next).not.toContain("zucchini flowers");
    expect(next).toContain("- [ ] 1 onion, diced");
    expect(next).toContain("- [ ] 2 cups flour *(Banana Bread)*");
  });

  it("an edit round-trips: what we write, we can read back", () => {
    const merged = applyMerge(noteOf(HAND_WRITTEN), [
      itemFromLine("1 cup flour", "Pancakes"),
    ]);
    const reread = linesOf(merged.markdown);
    const flour = reread.find((l) => l.item.name === "flour");
    expect(flour?.item.amount).toBe(3);
    expect(flour?.item.unit).toBe("cup");
    expect(flour?.item.sources).toEqual(["Banana Bread", "Pancakes"]);
  });
});

/**
 * Editing a row and stepping its count are the same line edit, and both have
 * the same way to go wrong: rewriting the line from the parse instead of from
 * the text, which eats the prep note.
 */
describe("editing a line", () => {
  const NOTE = [
    "# Shopping List",
    "",
    "- [ ] 1 onion, diced",
    "- [x] 2 cups flour *(Banana Bread)*",
    "- [ ] eggs",
    "",
  ].join("\n");

  it("opens the edit box on the cook's own words, not the parse", () => {
    const lines = linesOf(NOTE);
    // `formatItemText` would say "1 onion" here. The comma and what follows it
    // are what the edit box has to show.
    expect(bareText(lines[0].item.original)).toBe("1 onion, diced");
    // The source annotation belongs to the app, so it isn't in the box.
    expect(bareText(lines[1].item.original)).toBe("2 cups flour");
  });

  it("writes the new text verbatim and keeps the box and the source", () => {
    const next = setText(NOTE, 3, "3 cups bread flour");
    expect(next.split("\n")[3]).toBe(
      "- [x] 3 cups bread flour *(Banana Bread)*",
    );
    // The header and the neighbours don't move.
    expect(next.split("\n")[2]).toBe("- [ ] 1 onion, diced");
    expect(next.split("\n").length).toBe(NOTE.split("\n").length);
  });

  it("doesn't give a line two source annotations", () => {
    const next = setText(NOTE, 3, "3 cups flour *(Pancakes)*");
    expect(next.split("\n")[3]).toBe("- [x] 3 cups flour *(Pancakes)*");
  });

  it("leaves a line index that isn't an item alone", () => {
    expect(setText(NOTE, 0, "nope")).toBe(NOTE);
    expect(setText(NOTE, 99, "nope")).toBe(NOTE);
  });

  it("steps a count without touching the rest of the line", () => {
    expect(withAmount("1 onion, diced", 3)).toBe("3 onion, diced");
    expect(withAmount("eggs", 2)).toBe("2 eggs");
    expect(withAmount("2 eggs", 5)).toBe("5 eggs");
  });

  it("drops the number at one rather than writing '1 eggs'", () => {
    expect(withAmount("2 eggs", 1)).toBe("eggs");
    expect(withAmount("eggs", 1)).toBe("eggs");
  });

  it("writes a count that parses back out as an amount", () => {
    const next = setText(NOTE, 4, withAmount("eggs", 3));
    expect(next.split("\n")[4]).toBe("- [ ] 3 eggs");
    const reread = linesOf(next).find((l) => l.item.name === "egg");
    expect(reread?.item.amount).toBe(3);
    expect(reread?.item.unit).toBe("");
  });

  it("replaces a fraction rather than leaving it in front", () => {
    // Unicode and ASCII both, or "1/2 lemon" would step to "2 1/2 lemon".
    expect(withAmount("1/2 lemon", 2)).toBe("2 lemon");
    expect(withAmount("\u00bd lemon", 2)).toBe("2 lemon");
    expect(withAmount("1 1/2 onion", 2)).toBe("2 onion");
  });
});
