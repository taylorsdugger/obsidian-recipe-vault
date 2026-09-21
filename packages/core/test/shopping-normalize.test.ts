import { describe, expect, it } from "vitest";

import {
  aisleOrder,
  categorizeIngredient,
  compareByAisle,
  displayName,
  isPantryStaple,
  itemFromLine,
  itemsFromIngredientLine,
  mergeShoppingItems,
  normalizeShoppingName,
  pluraliseName,
  singulariseName,
} from "../src";
import {
  formatShoppingItemText,
  shoppingItemDetail,
  toShoppingLine,
} from "../src/shopping/markdown";

const key = (raw: string) => normalizeShoppingName(raw).key;

/**
 * The reason this module exists: a week of eight recipes used to put three
 * onions, three garlics and three broths on one list because the merge keys on
 * the name and the recipes all wrote it differently.
 */
describe("normalizeShoppingName", () => {
  it("folds the ways a recipe writes an onion", () => {
    expect(key("large onion")).toBe("onion");
    expect(key("yellow onions")).toBe("onion");
    expect(key("medium sweet onion")).toBe("onion");
    expect(key("spanish onion")).toBe("onion");
  });

  it("never strips a colour, because a colour can be the product", () => {
    // The trap: "yellow onion" is an onion, so it is tempting to treat colours
    // as padding. Then "sweet potato" becomes potato and "brown sugar" becomes
    // sugar, and you come home with the wrong thing. The onions fold by name
    // in the alias table instead.
    expect(key("sweet potatoes")).toBe("sweet potato");
    expect(key("brown rice")).toBe("brown rice");
    expect(key("dark brown sugar")).toBe("brown sugar");
    expect(key("white wine")).toBe("white wine");
    expect(key("white bread")).toBe("white bread");
    expect(key("yellow bell peppers")).toBe("yellow bell pepper");
    expect(key("yellow onions")).toBe("onion");
  });

  it("keeps a red onion apart, because you buy it apart", () => {
    // Yellow, white and sweet are interchangeable on the shelf. Red is not,
    // and folding it would send you home with the wrong one.
    expect(key("red onion")).toBe("red onion");
    expect(key("green onions")).toBe("scallion");
  });

  it("keeps the words that pick out a different product", () => {
    expect(key("ground beef")).toBe("ground beef");
    expect(key("whole milk")).toBe("whole milk");
    expect(key("dried oregano")).toBe("dried oregano");
    expect(key("crushed tomatoes")).toBe("crushed tomato");
    expect(key("smoked paprika")).toBe("smoked paprika");
    expect(key("toasted sesame oil")).toBe("toasted sesame oil");
  });

  it("drops the words that don't", () => {
    expect(key("finely chopped celery")).toBe("celery");
    expect(key("freshly ground black pepper")).toBe("black pepper");
    expect(key("good quality extra-virgin olive oil")).toBe("olive oil");
    expect(key("organic lemon")).toBe("lemon");
  });

  it("lifts the size words onto the row instead of deleting them", () => {
    const large = normalizeShoppingName("large yellow onion");
    expect(large.key).toBe("onion");
    // Still visible. Merging three onions is only safe if the row can say
    // what kinds they were - "large" came off as padding, "yellow" came back
    // from the alias that folded it.
    expect(large.qualifiers).toEqual(["large", "yellow"]);
  });

  it("keeps a two-word qualifier as one phrase", () => {
    // "low, sodium" under a row of broth reads like a mistake.
    const broth = normalizeShoppingName("low-sodium vegetable broth");
    expect(broth.key).toBe("vegetable broth");
    expect(broth.qualifiers).toEqual(["low sodium"]);
  });

  it("maps stock to broth and the salts to salt", () => {
    expect(key("vegetable stock")).toBe("vegetable broth");
    expect(key("veggie broth")).toBe("vegetable broth");
    expect(key("kosher salt")).toBe("salt");
    expect(key("flaky sea salt")).toBe("salt");
    expect(key("all-purpose flour")).toBe("flour");
  });

  it("reaches every alias entry through the stripping that runs first", () => {
    // An alias keyed on a spelling the stripper never produces is an entry
    // that can't fire. Hyphens get split, "of" gets dropped, the head noun
    // gets singularised - so these are the forms the table has to be written
    // in, and these are the lines that catch a table entry drifting out of
    // reach of them.
    expect(key("bicarbonate of soda")).toBe("baking soda");
    expect(key("flat-leaf parsley")).toBe("parsley");
    expect(key("parmigiano-reggiano")).toBe("parmesan");
    expect(key("garbanzo beans")).toBe("chickpeas");
    expect(key("corn starch")).toBe("cornstarch");
    expect(key("tamari")).toBe("soy sauce");
    expect(key("heavy whipping cream")).toBe("heavy cream");
    expect(key("granulated sugar")).toBe("sugar");
  });

  it("hands back an adjective an alias dropped, but not a renamed noun", () => {
    // "yellow" is worth seeing on the row. "clove" and "stock" are not - they
    // were the alias renaming the thing, not describing it.
    expect(normalizeShoppingName("kosher salt").qualifiers).toEqual(["kosher"]);
    expect(normalizeShoppingName("granulated sugar").qualifiers).toEqual([
      "granulated",
    ]);
    expect(normalizeShoppingName("3 garlic cloves").qualifiers).toEqual([]);
    expect(normalizeShoppingName("vegetable stock").qualifiers).toEqual([]);
  });

  it("takes the first of two alternatives when it can stand alone", () => {
    expect(key("vegan chicken broth or vegetable broth")).toBe(
      "vegan chicken broth",
    );
  });

  it("leaves an alternative alone when cutting it would lose the noun", () => {
    // "chicken or vegetable broth" is one thing written two ways. Cutting at
    // "or" would leave "chicken", which is a different aisle entirely.
    expect(key("chicken or vegetable broth")).toBe(
      "chicken or vegetable broth",
    );
  });

  it("falls back to the line when every word was padding", () => {
    // Nothing left to call the row, so the cleaned line is the name. Better a
    // bad name than a blank one - the row still has to say something.
    expect(key("finely chopped")).toBe("finely chopped");
    expect(key("to taste")).toBe("to taste");
  });
});

describe("singulariseName / pluraliseName", () => {
  it("round-trips the regular cases", () => {
    for (const [one, many] of [
      ["onion", "onions"],
      ["tomato", "tomatoes"],
      ["berry", "berries"],
      ["leaf", "leaves"],
      ["squash", "squashes"],
    ]) {
      expect(singulariseName(many)).toBe(one);
      expect(pluraliseName(one)).toBe(many);
    }
  });

  it("leaves words that only look plural alone", () => {
    // "hummu" and "asparagu" match nothing.
    for (const word of ["hummus", "asparagus", "couscous", "molasses"]) {
      expect(singulariseName(word)).toBe(word);
      expect(pluraliseName(word)).toBe(word);
    }
  });
});

describe("displayName", () => {
  it("follows the count on a countable row", () => {
    expect(displayName("onion", 3, "", false)).toBe("onions");
    expect(displayName("onion", 1, "", true)).toBe("onion");
  });

  it("keeps what the recipe wrote once there's a unit", () => {
    // "1 cup pea" is nobody's shopping list.
    expect(displayName("pea", 1, "cup", true)).toBe("peas");
    expect(displayName("flour", 2, "cup", false)).toBe("flour");
  });

  it("only touches the head noun", () => {
    expect(displayName("red onion", 2, "", false)).toBe("red onions");
  });
});

describe("itemsFromIngredientLine", () => {
  it("drops water, which is not shopping", () => {
    expect(itemsFromIngredientLine("2 cups water", "Soup")).toEqual([]);
    expect(itemsFromIngredientLine("1 cup boiling water", "Tea")).toEqual([]);
    // Something you actually buy keeps its row.
    expect(
      itemsFromIngredientLine("1 can coconut water", "Smoothie"),
    ).toHaveLength(1);
  });

  it("splits salt and pepper into two things to buy", () => {
    const items = itemsFromIngredientLine("Salt and pepper to taste", "Chili");
    expect(items.map((i) => i.name)).toEqual(["salt", "black pepper"]);
    // `original` follows the split, or both rows would render as the whole line.
    expect(items.map((i) => i.original)).toEqual(["salt", "black pepper"]);
  });

  it("won't split a measured line and double the measurement", () => {
    const items = itemsFromIngredientLine("1 tsp salt and pepper", "Rub");
    expect(items).toHaveLength(1);
  });

  it("leaves a line that only looks like a pair alone", () => {
    expect(
      itemsFromIngredientLine("1 box macaroni and cheese", "Dinner"),
    ).toHaveLength(1);
  });
});

/** The whole point, end to end: a week's worth of lines down to a short list. */
describe("a week of recipes", () => {
  const WEEK: [string, string[]][] = [
    [
      "Soup",
      [
        "1 large  onion, chopped",
        "4 cloves garlic, minced",
        "2 tablespoons olive oil",
        "1 teaspoon kosher salt",
        "3 carrots, sliced",
        "2 cups water",
      ],
    ],
    [
      "Chili",
      [
        "2 yellow onions, diced",
        "3 garlic cloves, minced",
        "1 tbsp extra-virgin olive oil",
        "Salt and pepper to taste",
        "2 cups vegetable broth",
      ],
    ],
    [
      "Stir Fry",
      [
        "1 medium onion, thinly sliced",
        "2 cloves of garlic",
        "1 tsp olive oil, divided",
        "2 large carrots",
        "1/4 cup low-sodium vegetable stock",
      ],
    ],
  ];

  const rows = () => {
    const incoming = WEEK.flatMap(([title, lines]) =>
      lines.flatMap((line) => itemsFromIngredientLine(line, title)),
    );
    return mergeShoppingItems([], incoming).items.sort(compareByAisle);
  };

  it("adds up the things that are the same thing", () => {
    const list = rows().map((item) => formatShoppingItemText(item));
    expect(list).toEqual([
      "5 carrots",
      "9 cloves garlic",
      "4 onions",
      "2¼ cups vegetable broth",
      "black pepper",
      "1 tsp salt",
      "3⅓ tbsp olive oil",
    ]);
  });

  it("groups them in store order, produce first", () => {
    const aisles = rows().map((item) => categorizeIngredient(item.name));
    expect([...new Set(aisles)]).toEqual([
      "produce",
      "canned",
      "spices",
      "condiments",
    ]);
  });

  it("still says which onions they were", () => {
    const onions = rows().find((item) => item.name === "onion");
    expect(onions?.qualifiers).toEqual(["large", "yellow", "medium"]);
    expect(onions?.sources).toEqual(["Soup", "Chili", "Stir Fry"]);
  });
});

/**
 * Rows that came off a real week's plan looking broken. Each one is a shape a
 * recipe site actually publishes, so each one gets a line here.
 */
describe("the lines that came out wrong", () => {
  const row = (line: string) => {
    const items = itemsFromIngredientLine(line, "R");
    return items.map((item) => ({
      text: formatShoppingItemText(item),
      detail: shoppingItemDetail(item),
      aisle: categorizeIngredient(item.name),
    }));
  };

  it("folds an accent instead of deleting the letter", () => {
    // The tokeniser keeps a-z0-9, so an unfolded "ñ" was dropped outright and
    // the row read "2 jalapeos" - which also matched nothing in the aisles.
    expect(row("2 jalapeños, seeded and diced")[0]).toMatchObject({
      text: "2 jalapenos",
      aisle: "produce",
    });
    expect(key("crème fraîche")).toBe("creme fraiche");
  });

  it("counts the cans, not the ounces on the can", () => {
    // "2 20-ounce cans ..." read "ounce" as the unit, and the size and the
    // packing liquid both ended up in the name.
    expect(row("2 20-ounce cans young green jackfruit in water")[0]).toEqual({
      text: "2 cans young green jackfruit",
      detail: "20 ounce",
      aisle: "canned",
    });
  });

  it("doesn't put an s on something you don't count", () => {
    // "3 cups water" came out as "waters", and "2 sticks butter" as "butters".
    expect(pluraliseName("water")).toBe("water");
    expect(row("2 sticks butter")[0].text).toBe("2 sticks butter");
  });

  it("keeps the kind of tinned tomato it is", () => {
    // "diced" is prep on "diced onion" and the product on "diced tomatoes",
    // and they are not the same can.
    expect(row("1 (14.5 oz.) can diced tomatoes")[0]).toEqual({
      text: "1 can diced tomatoes",
      detail: "14.5 oz",
      aisle: "canned",
    });
    expect(key("diced onion")).toBe("onion");
    expect(row("2 cups diced onion")[0].text).toBe("2 cups onion");
  });

  it("takes one name when a slash gives two for the same leaf", () => {
    expect(row("2 cups arugula/rocket")[0].text).toBe("2 cups arugula");
  });

  it("reads a parenthesised plural marker as one, not as a note", () => {
    // "2 orange(s)" was coming out with a detail line that said "(s)".
    expect(row("2 orange(s)")[0]).toMatchObject({
      text: "2 oranges",
      detail: "",
    });
    expect(row("2 sprig(s) of thyme")[0]).toMatchObject({
      text: "2 sprigs thyme",
      detail: "",
    });
  });

  /*
   * The two rows that started this: a list row reading just "chopped", and one
   * reading "2 s". Both are what is left when the reduction eats everything -
   * a line that was only a prep word, or a name a site's markup left as a
   * stray letter. Neither is fixable by guessing, so the row shows the line as
   * written instead, where it can be read and corrected.
   */
  it("marks a line that names nothing, and keeps it as written", () => {
    expect(row("1/4 cup walnuts, finely chopped")[0].text).toBe(
      "¼ cup walnuts",
    );

    for (const junk of ["chopped", "finely chopped", "2 s", "s"]) {
      const item = itemFromLine(junk, "R");
      expect(item.fragment).toBe(true);
      // Verbatim, and with no amount or unit, so nothing adds it up with
      // another row that reduced to the same junk.
      expect(item.name).toBe(junk.toLowerCase());
      expect(item.amount).toBe(0);
      expect(item.unit).toBe("");
    }
  });

  it("reads a name the source shut its bracket in front of", () => {
    // Real vault line. The ")" belongs after "oz.", so everything ended up
    // inside the parenthetical, no name survived, and the row was the whole
    // line verbatim.
    expect(
      row("1 can (15 oz. cannellini beans, drained and rinsed)")[0],
    ).toEqual({
      text: "1 can cannellini beans",
      detail: "15 oz, drained and rinsed",
      aisle: "grains",
    });
    // Same line with the bracket where it belongs reads the same way.
    expect(
      row("1 can (15 oz.) cannellini beans, drained and rinsed")[0],
    ).toEqual({
      text: "1 can cannellini beans",
      detail: "15 oz, drained and rinsed",
      aisle: "grains",
    });
  });

  it("drops a line that is only a fragment of one", () => {
    // Real vault lines, all three from one recipe - what an import leaves
    // behind when it splits a line. There is no ingredient in them, so they
    // are not rows.
    for (const fragment of [
      "(optional)",
      "(plus more as needed)",
      "chopped",
      "2 s",
      "finely diced",
    ]) {
      expect(itemsFromIngredientLine(fragment, "R")).toEqual([]);
    }
  });

  it("keeps a fragment already written on the list", () => {
    // Dropping happens on the way in from a recipe. A line the cook typed, or
    // one already in the note, is theirs - it stays, and it stays verbatim.
    const item = itemFromLine("(optional)", "");
    expect(item.fragment).toBe(true);
    expect(item.name).toBe("(optional)");
    expect(toShoppingLine(item)).toBe("- [ ] (optional)");
  });

  it("still merges two free-text rows that say the same thing", () => {
    // Dropping fragments is an ingestion rule, not a merge rule. Two rows the
    // cook typed the same way are still one row.
    const { items } = mergeShoppingItems(
      [],
      [
        itemFromLine("something for pudding", "Salad"),
        itemFromLine("something for pudding", "Chili"),
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0].sources).toEqual(["Salad", "Chili"]);
  });
});

describe("categorizeIngredient", () => {
  it("prefers the longer phrase", () => {
    // "coconut milk" is a can; following "milk" would send it to the dairy case.
    expect(categorizeIngredient("coconut milk")).toBe("canned");
    expect(categorizeIngredient("milk")).toBe("dairy");
    // "black pepper" is a spice; "pepper" alone is the vegetable.
    expect(categorizeIngredient("black pepper")).toBe("spices");
    expect(categorizeIngredient("bell pepper")).toBe("produce");
  });

  it("matches whole words only", () => {
    // "cornbread" is not corn.
    expect(categorizeIngredient("cornbread")).toBe("other");
  });

  it("sends the unknown to the end rather than guessing", () => {
    expect(categorizeIngredient("gubbins")).toBe("other");
    expect(aisleOrder("other")).toBeGreaterThan(aisleOrder("produce"));
    expect(aisleOrder("nonsense")).toBeGreaterThanOrEqual(aisleOrder("other"));
  });
});

describe("isPantryStaple", () => {
  it("is water and ice, and nothing that shares their name", () => {
    expect(isPantryStaple("water")).toBe(true);
    expect(isPantryStaple("ice")).toBe(true);
    expect(isPantryStaple("coconut water")).toBe(false);
    expect(isPantryStaple("sparkling water")).toBe(false);
    expect(isPantryStaple("ice cream")).toBe(false);
  });
});
