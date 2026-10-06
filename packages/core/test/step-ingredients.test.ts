import { describe, expect, it } from "vitest";

import {
  chipText,
  ingredientName,
  ingredientsForStep,
  ingredientsForSteps,
} from "../src/note/step-ingredients";

const CURRY = [
  "2 cans (15 oz) chickpeas, drained",
  "1 large yellow onion, diced",
  "4 cloves garlic, minced",
  "1 tbsp fresh ginger, grated",
  "1 green chili, slit",
  "2 tsp garam masala",
  "1 tsp ground cumin",
  "1 can (14 oz) crushed tomatoes",
  "3/4 cup coconut milk",
  "5 oz baby spinach",
  "2 tbsp olive oil",
];

describe("chipText", () => {
  it("keeps the quantity and drops the prep and the parenthetical", () => {
    expect(chipText("2 cans (15 oz) chickpeas, drained")).toBe(
      "2 cans chickpeas",
    );
    expect(chipText("Salt")).toBe("Salt");
  });
});

describe("ingredientName", () => {
  it("strips numbers, units and size words", () => {
    expect(ingredientName("1 large yellow onion, diced")).toBe("yellow onion");
    expect(ingredientName("4 cloves garlic, minced")).toBe("garlic");
    expect(ingredientName("3/4 cup coconut milk")).toBe("coconut milk");
    expect(ingredientName("1 1/2 tsp ground cumin")).toBe("cumin");
    expect(ingredientName("½ lemon")).toBe("lemon");
    expect(ingredientName("2-3 tbsp. olive oil")).toBe("olive oil");
  });

  it("drops what's said about the amount after the name", () => {
    expect(ingredientName("Salt and pepper to taste")).toBe("salt and pepper");
    expect(ingredientName("Parsley for garnish")).toBe("parsley");
    expect(ingredientName("1 tbsp oil, plus more for frying")).toBe("oil");
    expect(ingredientName("a pinch of salt")).toBe("salt");
  });

  it("doesn't mistake a word for a one-letter unit", () => {
    expect(ingredientName("2 carrots")).toBe("carrots");
    expect(ingredientName("1 lime")).toBe("lime");
  });
});

describe("ingredientsForStep", () => {
  it("finds the whole name or its last word", () => {
    expect(
      ingredientsForStep(
        "Stir in the garlic, ginger and chili for 1 minute, then the garam masala and cumin for 30 seconds.",
        CURRY,
      ),
    ).toEqual([
      "4 cloves garlic",
      "1 tbsp fresh ginger",
      "1 green chili",
      "2 tsp garam masala",
      "1 tsp ground cumin",
    ]);
  });

  it("matches singular against plural", () => {
    expect(
      ingredientsForStep("Pat the chickpeas dry. Add the tomato.", CURRY),
    ).toEqual(["2 cans chickpeas", "1 can crushed tomatoes"]);
  });

  it("matches whole words only", () => {
    expect(ingredientsForStep("Bring a pot of water to a boil.", CURRY)).toEqual(
      [],
    );
  });

  it("is empty when nothing is mentioned", () => {
    expect(ingredientsForStep("Serve over rice.", CURRY)).toEqual([]);
  });
});

describe("ingredientsForStep, telling ingredients apart", () => {
  it("doesn't find a short name inside a longer word", () => {
    const lines = ["2 tbsp oil", "1 tsp salt", "1 egg", "1 cup ice"];
    expect(
      ingredientsForStep(
        "Boil the eggplant in unsalted water, then dice it.",
        lines,
      ),
    ).toEqual([]);
  });

  it("gives a mention to the most specific name", () => {
    const lines = ["2 tbsp olive oil", "1 tsp toasted sesame oil"];
    expect(ingredientsForStep("Drizzle with the sesame oil.", lines)).toEqual(
      ["1 tsp toasted sesame oil"],
    );
    expect(ingredientsForStep("Heat the olive oil.", lines)).toEqual([
      "2 tbsp olive oil",
    ]);
  });

  it("doesn't take half a name that the step spells out as something else", () => {
    const lines = ["4 cloves garlic", "1 tsp garlic powder"];
    expect(ingredientsForStep("Add the garlic powder.", lines)).toEqual([
      "1 tsp garlic powder",
    ]);
    expect(ingredientsForStep("Add the garlic.", lines)).toEqual([
      "4 cloves garlic",
    ]);

    const lemon = ["zest of 1 lemon", "juice of 1 lemon"];
    expect(ingredientsForStep("Stir in the lemon juice.", lemon)).toEqual([
      "juice of 1 lemon",
    ]);
  });

  it("matches each half of salt and pepper, and not the word taste", () => {
    const lines = ["Salt and pepper to taste", "2 lbs chicken"];
    expect(ingredientsForStep("Season to taste.", lines)).toEqual([]);
    expect(ingredientsForStep("Season the chicken with salt.", lines)).toEqual(
      ["Salt and pepper to taste", "2 lbs chicken"],
    );
  });

  it("doesn't read across a comma", () => {
    const lines = ["1 tsp garlic powder", "1 large yellow onion"];
    expect(ingredientsForStep("Add the garlic, onion and stock.", lines)).toEqual(
      ["1 large yellow onion"],
    );
  });
});

describe("ingredientsForSteps", () => {
  // Two of everything: the filling's and the crumble's.
  const CRUMBLE = [
    "4 apples, sliced",
    "2 tbsp butter",
    "1/4 cup sugar",
    "1 cup oats",
    "6 tbsp butter, cold",
    "1/2 cup brown sugar",
  ];

  it("reads the recipe top down when two lines are the same thing", () => {
    expect(
      ingredientsForSteps(
        [
          "Cook the apples in the butter with the sugar until soft.",
          "Rub the butter into the oats and brown sugar.",
          "Scatter over the apples and bake.",
        ],
        CRUMBLE,
      ),
    ).toEqual([
      ["4 apples", "2 tbsp butter", "1/4 cup sugar"],
      ["1 cup oats", "6 tbsp butter", "1/2 cup brown sugar"],
      ["4 apples"],
    ]);
  });

  it("gives a repeated mention in one step to one line", () => {
    expect(
      ingredientsForSteps(
        ["Melt the butter, then brush the pan with more butter."],
        CRUMBLE,
      ),
    ).toEqual([["2 tbsp butter"]]);
  });

  it("goes back to the latest line once every copy has been used", () => {
    expect(
      ingredientsForSteps(
        [
          "Melt the butter.",
          "Rub in the cold butter.",
          "Dot the top with butter.",
        ],
        CRUMBLE,
      ),
    ).toEqual([["2 tbsp butter"], ["6 tbsp butter"], ["6 tbsp butter"]]);
  });
});

describe("ingredientsForSteps, an imported note", () => {
  // Potato Leek Soup as the importer writes it: the prep inside parentheses
  // after a comma, and parentheses inside those. Every line used to keep a
  // stray "(" or ")" on its name, so only the butter was ever found.
  const LINES = [
    "1 1/2 tablespoons olive oil ((or preferred oil))",
    "1  tablespoon vegan butter",
    "1  small onion (, diced)",
    "3  large leeks (, cleaned well & thinly sliced (white & light green part only) *See note)",
    "5  medium russet potatoes (, peeled and chopped)",
    "3-4 cloves of garlic (, minced)",
    "1 teaspoon salt (, more to taste)",
    "Fresh ground pepper (, to taste)",
    "1 1/2 teaspoons dried thyme",
    "1/2 teaspoon dried rosemary",
    "1/2 teaspoon ground coriander ((optional))",
    "5  cups vegetable broth ((low sodium) )",
    "2  bay leaves",
    "1-2 tablespoons fresh lemon juice ((optional))",
    "1 cup canned coconut milk ((or any unsweetened plant-based milk))",
    "Green onion (, chopped)",
    "Pieces of cooked potato",
    "Fresh ground pepper",
  ];
  const STEPS = [
    "Heat the oil, butter and a pinch of salt in a large pot over medium heat. Add the leeks & onion, sauté until softened, about 5-6 minutes.",
    "Add the potatoes, garlic, thyme, rosemary, and coriander. Sauté for 2-3 minutes.",
    "Add the vegetable broth, bay leaf, salt, and pepper. Raise heat so it starts to simmer. Now reduce heat to a low simmer and cook for about 15-20 minutes, or until the potatoes are fork tender.",
    "Remove from heat and remove bay leaves. Stir in the coconut milk and optional lemon juice. Taste for seasoning and add more to taste.",
    "Serve in soup bowls and top with chopped green onion, fresh ground pepper and a few pieces of cooked potato.",
  ];

  it("finds every ingredient each step names", () => {
    expect(ingredientsForSteps(STEPS, LINES)).toEqual([
      [
        "1 1/2 tablespoons olive oil",
        "1 tablespoon vegan butter",
        "1 small onion",
        "3 large leeks",
        "1 teaspoon salt",
      ],
      [
        "5 medium russet potatoes",
        "3-4 cloves of garlic",
        "1 1/2 teaspoons dried thyme",
        "1/2 teaspoon dried rosemary",
        "1/2 teaspoon ground coriander",
      ],
      [
        "5 medium russet potatoes",
        "1 teaspoon salt",
        "Fresh ground pepper",
        "5 cups vegetable broth",
        "2 bay leaves",
      ],
      [
        "2 bay leaves",
        "1-2 tablespoons fresh lemon juice",
        "1 cup canned coconut milk",
      ],
      ["Green onion", "Pieces of cooked potato", "Fresh ground pepper"],
    ]);
  });
});

describe("chipText, from a note", () => {
  it("drops links and emphasis but keeps the words", () => {
    expect(chipText("2 tbsp [[Chili Crisp]], to serve")).toBe(
      "2 tbsp Chili Crisp",
    );
    expect(chipText("1 cup [stock](https://example.com) *warm*")).toBe(
      "1 cup stock warm",
    );
  });
});
