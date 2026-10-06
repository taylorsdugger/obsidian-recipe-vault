import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeVault, makeFakeApp } from "./helpers/fake-vault";
import {
  htmlResponse,
  makePlugin,
  resetObsidianStub,
  setRequestUrl,
} from "./helpers/plugin";
import { noticeLog } from "./helpers/obsidian-stub";

/** A recipe page whose JSON-LD carries the given nutrition, or none. */
function page(name: string, nutrition?: Record<string, string>): string {
  const recipe = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    recipeIngredient: ["1 thing"],
    recipeInstructions: ["Cook it."],
    ...(nutrition ? { nutrition } : {}),
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(
    recipe,
  )}</script></head><body></body></html>`;
}

function note(title: string, frontmatter: string): string {
  return [
    "---",
    "cssclasses: recipe-note",
    frontmatter,
    "---",
    "",
    `# ${title}`,
    "",
    "### Ingredients",
    "",
    "- [ ] 1 thing",
    "",
    "### Instructions",
    "",
    "- Cook it.",
    "",
  ].join("\n");
}

function setup() {
  const vault = new FakeVault();
  const plugin = makePlugin({ folder: "Recipes" });
  plugin.app = makeFakeApp(vault) as any;
  plugin.nutritionFetchGapMs = 0;
  const run = async () => {
    const p = plugin as any;
    await p.runNutritionBackfill(await p.nutritionTargets());
  };
  return { vault, plugin, run };
}

describe("nutrition backfill", () => {
  beforeEach(() => resetObsidianStub());

  it("fetches only recipes with a source link and something missing", async () => {
    const { vault, run } = setup();
    await vault.seed(
      "Recipes/Curry.md",
      note("Curry", "url: https://a.example/curry"),
    );
    await vault.seed(
      "Recipes/Pie.md",
      note(
        "Pie",
        "url: https://a.example/pie\ncalories: 400\nservings: 8\nserving_size: 1 slice",
      ),
    );
    await vault.seed("Recipes/Mine.md", note("Mine", "url:"));
    await vault.seed(
      "Recipes/Soup.cook",
      "---\nsource: https://a.example/soup\n---\n\nSimmer @leeks{2}.\n",
    );
    const asked: string[] = [];
    setRequestUrl(({ url }) => {
      asked.push(url);
      return htmlResponse(
        url.endsWith("curry")
          ? page("Curry", { calories: "530 kcal", proteinContent: "17 g" })
          : page("Soup", { calories: "210 calories" }),
      );
    });

    await run();

    expect(asked.sort()).toEqual([
      "https://a.example/curry",
      "https://a.example/soup",
    ]);
    expect(vault.text("Recipes/Curry.md")).toContain(
      "url: https://a.example/curry\ncalories: 530\nprotein: 17\n---",
    );
    expect(vault.text("Recipes/Soup.cook")).toContain("calories: 210\n");
    expect(vault.text("Recipes/Pie.md")).not.toContain("protein");
    expect(noticeLog.at(-1)).toBe("Updated 2 recipes.");
  });

  it("counts pages with none and pages that fail, and keeps going", async () => {
    const { vault, run } = setup();
    for (const name of ["A", "B", "C"]) {
      await vault.seed(
        `Recipes/${name}.md`,
        note(name, `url: https://a.example/${name}`),
      );
    }
    setRequestUrl(({ url }) => {
      if (url.endsWith("A")) throw new Error("offline");
      return htmlResponse(
        url.endsWith("B") ? page("B") : page("C", { calories: "100" }),
      );
    });

    await run();

    expect(vault.text("Recipes/B.md")).not.toContain("calories");
    expect(vault.text("Recipes/C.md")).toContain("calories: 100");
    expect(noticeLog.at(-1)).toBe(
      "Updated 1 recipe, 1 source page had nothing to add, 1 couldn't be loaded (the console has which).",
    );
  });

  it("stops after the page it's on when asked", async () => {
    const { vault, plugin, run } = setup();
    for (const name of ["A", "B", "C"]) {
      await vault.seed(
        `Recipes/${name}.md`,
        note(name, `url: https://a.example/${name}`),
      );
    }
    let fetched = 0;
    setRequestUrl(() => {
      fetched++;
      // What the "Stop fetching nutrition" command does.
      (plugin as any).nutritionRun.stopped = true;
      return htmlResponse(page("A", { calories: "100" }));
    });

    await run();

    expect(fetched).toBe(1);
    expect(noticeLog.at(-1)).toBe("Stopped. Updated 1 recipe.");
    expect((plugin as any).nutritionRun).toBeNull();
  });

  it("reads a real recipe page", async () => {
    const { vault, run } = setup();
    // A note imported before nutrition, the way the template wrote it then.
    await vault.seed(
      "Recipes/Vegan Chicken Noodle Soup.md",
      note(
        "Vegan Chicken Noodle Soup",
        "servings: 10\nurl: https://www.noracooks.com/vegan-chicken-noodle-soup/\ntimes_made: 2\nlast_made:",
      ),
    );
    const html = readFileSync(
      "test/fixtures/noracooks-vegan-chicken-noodle-soup.html",
      "utf8",
    );
    setRequestUrl(() => htmlResponse(html));

    await run();

    expect(vault.text("Recipes/Vegan Chicken Noodle Soup.md")).toContain(
      [
        "last_made:",
        "calories: 208",
        "protein: 11",
        "carbs: 33",
        "fat: 4",
        "fiber: 2",
        "sugar: 4",
        "sodium: 902",
        "serving_size: 1 serving",
        "---",
      ].join("\n"),
    );
  });

  it("won't start a second run over one that's going", async () => {
    const { vault, plugin, run } = setup();
    await vault.seed("Recipes/A.md", note("A", "url: https://a.example/A"));
    let fetched = 0;
    setRequestUrl(() => {
      fetched++;
      return htmlResponse(page("A", { calories: "100" }));
    });
    (plugin as any).nutritionRun = { stopped: false };

    await run();

    expect(fetched).toBe(0);
  });

  it("fills in what an older note with nutrition is missing", async () => {
    const { vault, run } = setup();
    // Like the apple fritters note: nutrition from an earlier backfill, but
    // imported before the template wrote `servings`.
    await vault.seed(
      "Recipes/Apple Fritters.md",
      note(
        "Apple Fritters",
        "url: https://www.noracooks.com/apple-fritters/\ncalories: 262\nprotein: 2\ncarbs: 43\nfat: 10",
      ),
    );
    // The page's own JSON-LD.
    const recipe = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Apple Fritters",
      recipeYield: ["12", "12 fritters"],
      recipeIngredient: ["2 apples"],
      recipeInstructions: ["Fry them."],
      nutrition: {
        "@type": "NutritionInformation",
        servingSize: "1 of 12 fritters",
        calories: "262 kcal",
        carbohydrateContent: "43 g",
        proteinContent: "2 g",
        fatContent: "10 g",
        sodiumContent: "107 mg",
      },
    };
    setRequestUrl(() =>
      htmlResponse(
        `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`,
      ),
    );

    await run();

    expect(vault.text("Recipes/Apple Fritters.md")).toContain(
      [
        "fat: 10",
        "sodium: 107",
        "serving_size: 1 of 12 fritters",
        "servings: 12",
        "---",
      ].join("\n"),
    );
    expect(noticeLog.at(-1)).toBe("Updated 1 recipe.");
  });
});
