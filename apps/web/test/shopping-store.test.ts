import { describe, expect, it } from "vitest";
import { itemFromLine } from "@recipe-vault/core";
import { removeCheckedItems } from "@recipe-vault/core/shopping/markdown";

import {
  applyMerge,
  bareText,
  linesOf,
  removeLine,
  setChecked,
  setText,
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
    expect(lines.map((l) => l.item.name)).toEqual([
      "onion",
      "zucchini flowers",
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

  it("merges into the matching line and appends the rest", () => {
    const result = applyMerge(noteOf(HAND_WRITTEN), [
      itemFromLine("1 cup flour", "Pancakes"),
      itemFromLine("3 lemons", "Pancakes"),
    ]);

    expect(result.merged).toBe(1);
    expect(result.added).toBe(1);

    const lines = result.markdown.split("\n");
    // Flour went 2 cup + 1 cup = 3, and picked up the second source.
    expect(lines[6]).toBe("- [ ] 3 cups flour *(Banana Bread, Pancakes)*");
    // Lemons appended at the end.
    expect(lines.at(-2)).toBe("- [ ] 3 lemons *(Pancakes)*");
    // Header and the untouched lines survive verbatim.
    expect(lines[2]).toBe("Costco run, not the corner shop.");
    expect(lines[4]).toBe("- [ ] 1 onion, diced");
    expect(lines[5]).toBe("- [x] zucchini flowers");
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
    const reread = linesOf(next).find((l) => l.item.name === "eggs");
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
