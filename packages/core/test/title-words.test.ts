import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TITLE_WORD_LISTS } from "../src";

/**
 * The word files are the part people outside the codebase edit, so these
 * catch the mistakes a JSON-only pull request can make.
 */
const DIR = fileURLToPath(
  new URL("../src/parse/title-words/", import.meta.url),
);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("title word lists", () => {
  it("registers every language file in index.ts", () => {
    const codes = FILES.map((f) => f.replace(/\.json$/, "")).sort();
    expect(Object.keys(TITLE_WORD_LISTS).sort()).toEqual(codes);
  });

  for (const file of FILES) {
    describe(file, () => {
      const list = JSON.parse(readFileSync(DIR + file, "utf8"));

      it("is named after a two-letter language code", () => {
        expect(file).toMatch(/^[a-z]{2}\.json$/);
      });

      it("has a name and the three lists", () => {
        expect(typeof list.name).toBe("string");
        expect(list.name.length).toBeGreaterThan(0);
        for (const key of ["filler", "vegan", "glutenFree"]) {
          expect(Array.isArray(list[key])).toBe(true);
          for (const entry of list[key]) expect(typeof entry).toBe("string");
        }
      });

      it("only has patterns that compile", () => {
        for (const key of ["filler", "vegan", "glutenFree"]) {
          for (const entry of list[key]) {
            expect(() => new RegExp(entry, "giu"), entry).not.toThrow();
            // An empty match would strip nothing and loop forever on replace.
            expect(new RegExp(`^(?:${entry})$`, "iu").test(""), entry).toBe(
              false,
            );
          }
        }
      });

      it("has no duplicates", () => {
        const all = [...list.filler, ...list.vegan, ...list.glutenFree];
        expect(new Set(all).size).toBe(all.length);
      });
    });
  }
});
