/**
 * Which part of the shop a thing is in, so the list stops sending you back
 * and forth.
 *
 * A week's shop built from eight recipes comes out grouped by recipe, which
 * means produce at the top, dry goods in the middle and more produce at the
 * bottom. Sorting on an aisle puts the onions next to the carrots.
 *
 * `AISLES` is in walking order, not alphabetical: produce first because it is
 * by the door, cold and frozen last because you want them in the trolley last.
 * Nobody's shop is laid out exactly like this. Reorder the array and the whole
 * list reorders with it — that is the only change needed to match a store.
 */

export interface Aisle {
  id: string;
  /** What the group header says. */
  label: string;
}

export const AISLES: Aisle[] = [
  { id: "produce", label: "Produce" },
  { id: "bakery", label: "Bakery" },
  { id: "deli", label: "Deli" },
  { id: "meat", label: "Meat" },
  { id: "canned", label: "Canned & Jarred" },
  { id: "grains", label: "Pasta, Rice & Beans" },
  { id: "baking", label: "Baking & Dry Goods" },
  { id: "spices", label: "Spices" },
  { id: "condiments", label: "Condiments & Sauces" },
  { id: "snacks", label: "Snacks" },
  { id: "drinks", label: "Drinks" },
  { id: "dairy", label: "Refrigerated" },
  { id: "frozen", label: "Frozen" },
  { id: "household", label: "Household" },
  { id: "other", label: "Other" },
];

const ORDER = new Map(AISLES.map((aisle, i) => [aisle.id, i]));

/** The bucket for anything the dictionary doesn't know. Sorts last. */
export const OTHER_AISLE = "other";

/**
 * Keywords per aisle. Matched as whole words against the normalized name, and
 * the longest match across every aisle wins — so "coconut milk" lands in
 * canned goods rather than following "milk" to the dairy case.
 *
 * Multi-word keys are the override mechanism. Add the specific phrase to the
 * aisle it actually lives in and it beats the generic word.
 */
const KEYWORDS: Record<string, string[]> = {
  produce: [
    "onion",
    "red onion",
    "scallion",
    "shallot",
    "leek",
    "garlic",
    "ginger",
    "carrot",
    "celery",
    "potato",
    "sweet potato",
    "tomato",
    "cherry tomato",
    "cucumber",
    "lettuce",
    "romaine",
    "spinach",
    "kale",
    "arugula",
    "cabbage",
    "broccoli",
    "cauliflower",
    "zucchini",
    "squash",
    "eggplant",
    "mushroom",
    "pepper" /* the vegetable; "black pepper" is longer and wins for spice */,
    "bell pepper",
    "jalapeno",
    "serrano",
    "poblano",
    "chile",
    "corn",
    "green bean",
    "pea",
    "snap pea",
    "asparagus",
    "brussels sprout",
    "beet",
    "radish",
    "turnip",
    "parsnip",
    "fennel",
    "avocado",
    "lemon",
    "lime",
    "orange",
    "grapefruit",
    "apple",
    "banana",
    "pear",
    "peach",
    "plum",
    "grape",
    "strawberry",
    "blueberry",
    "raspberry",
    "blackberry",
    "mango",
    "pineapple",
    "melon",
    "watermelon",
    "cantaloupe",
    "cilantro",
    "parsley",
    "basil",
    "mint",
    "dill",
    "chive",
    "rosemary",
    "thyme",
    "sage",
    "tarragon",
    "sprout",
    "herb",
  ],

  bakery: [
    "bread",
    "baguette",
    "roll",
    "bun",
    "hamburger bun",
    "hot dog bun",
    "tortilla",
    "pita",
    "naan",
    "bagel",
    "english muffin",
    "croissant",
    "sourdough",
    "brioche",
    "focaccia",
    "breadcrumb",
    "panko",
    "crouton",
    "pie crust",
    "puff pastry",
  ],

  deli: [
    "deli",
    "prosciutto",
    "salami",
    "pepperoni",
    "ham",
    "turkey slice",
    "roast beef",
    "pastrami",
    "hummus",
    "olive bar",
  ],

  meat: [
    "beef",
    "ground beef",
    "steak",
    "brisket",
    "chuck roast",
    "short rib",
    "pork",
    "ground pork",
    "pork chop",
    "pork shoulder",
    "bacon",
    "sausage",
    "chorizo",
    "chicken",
    "chicken breast",
    "chicken thigh",
    "chicken wing",
    "rotisserie chicken",
    "turkey",
    "ground turkey",
    "lamb",
    "veal",
    "meatball",
  ],

  canned: [
    "canned",
    "crushed tomato",
    "diced tomato",
    "whole peeled tomato",
    "tomato sauce",
    "tomato paste",
    "tomato puree",
    "passata",
    "broth",
    "stock",
    "bone broth",
    "chicken broth",
    "chicken stock",
    "beef broth",
    "beef stock",
    "vegetable broth",
    "vegetable stock",
    "mushroom broth",
    "bouillon",
    "coconut milk",
    "coconut cream",
    "evaporated milk",
    "condensed milk",
    "canned tuna",
    "sardine",
    "anchovy",
    "artichoke heart",
    "hearts of palm",
    "jackfruit",
    "applesauce",
    "apple sauce",
    "roasted red pepper",
    "sun dried tomato",
    "pumpkin puree",
    "olive",
    "caper",
    "pickle",
    "jam",
    "jelly",
    "preserve",
  ],

  grains: [
    "pasta",
    "spaghetti",
    "penne",
    "rigatoni",
    "macaroni",
    "fettuccine",
    "linguine",
    "lasagna noodle",
    "orzo",
    "couscous",
    "noodle",
    "rice noodle",
    "egg noodle",
    "ramen",
    "rice",
    "basmati rice",
    "jasmine rice",
    "brown rice",
    "arborio rice",
    "quinoa",
    "farro",
    "barley",
    "bulgur",
    "lentil",
    "bean",
    "black bean",
    "kidney bean",
    "pinto bean",
    "cannellini bean",
    "chickpeas",
    "chickpea",
    "split pea",
  ],

  baking: [
    "flour",
    "bread flour",
    "cake flour",
    "whole wheat flour",
    "sugar",
    "brown sugar",
    "powdered sugar",
    "confectioners sugar",
    "baking powder",
    "baking soda",
    "yeast",
    "cornstarch",
    "cocoa powder",
    "chocolate chip",
    "chocolate",
    "vanilla extract",
    "almond extract",
    "molasses",
    "honey",
    "maple syrup",
    "corn syrup",
    "oat",
    "rolled oat",
    "cornmeal",
    "polenta",
    "gelatin",
    "nutritional yeast",
    "protein powder",
    "coconut flake",
    "shredded coconut",
    "raisin",
    "date",
    "dried cranberry",
    "almond",
    "walnut",
    "pecan",
    "cashew",
    "peanut",
    "pistachio",
    "pine nut",
    "sesame seed",
    "sunflower seed",
    "pumpkin seed",
    "chia seed",
    "flaxseed",
    "nut",
    "seed",
  ],

  spices: [
    "salt",
    "black pepper",
    "peppercorn",
    "cumin",
    "coriander",
    "paprika",
    "smoked paprika",
    "chili powder",
    "cayenne",
    "red pepper flake",
    "turmeric",
    "cinnamon",
    "nutmeg",
    "clove",
    "allspice",
    "cardamom",
    "star anise",
    "bay leaf",
    "oregano",
    "dried oregano",
    "dried basil",
    "dried thyme",
    "dried rosemary",
    "italian seasoning",
    "garlic powder",
    "onion powder",
    "curry powder",
    "garam masala",
    "za atar",
    "old bay",
    "seasoning",
    "spice",
    "extract",
  ],

  condiments: [
    "olive oil",
    "vegetable oil",
    "sesame oil",
    "coconut oil",
    "avocado oil",
    "oil",
    "vinegar",
    "balsamic vinegar",
    "rice vinegar",
    "apple cider vinegar",
    "soy sauce",
    "fish sauce",
    "worcestershire",
    "hot sauce",
    "sriracha",
    "harissa",
    "gochujang",
    "miso",
    "tahini",
    "peanut butter",
    "almond butter",
    "mayonnaise",
    "mayo",
    "mustard",
    "dijon mustard",
    "ketchup",
    "bbq sauce",
    "barbecue sauce",
    "salsa",
    "guacamole",
    "dressing",
    "ranch",
    "relish",
    "marinade",
    "curry paste",
    "chili paste",
    "liquid smoke",
  ],

  snacks: [
    "chip",
    "tortilla chip",
    "pretzel",
    "cracker",
    "popcorn",
    "granola bar",
    "cookie",
    "candy",
    "marshmallow",
    "trail mix",
  ],

  drinks: [
    "juice",
    "orange juice",
    "lemonade",
    "coffee",
    "tea",
    "soda",
    "sparkling water",
    "coconut water",
    "wine",
    "white wine",
    "red wine",
    "beer",
    "sherry",
    "vermouth",
    "rum",
    "bourbon",
    "vodka",
    "tequila",
    "mirin",
    "sake",
  ],

  dairy: [
    "milk",
    "whole milk",
    "oat milk",
    "almond milk",
    "soy milk",
    "buttermilk",
    "cream",
    "heavy cream",
    "sour cream",
    "half and half",
    "butter",
    "margarine",
    "ghee",
    "yogurt",
    "greek yogurt",
    "egg",
    "egg white",
    "egg yolk",
    "cheese",
    "cheddar",
    "mozzarella",
    "parmesan",
    "pecorino",
    "feta",
    "goat cheese",
    "cream cheese",
    "ricotta",
    "cottage cheese",
    "gruyere",
    "provolone",
    "monterey jack",
    "tofu",
    "tempeh",
    "seitan",
    "biscuit dough",
    "crescent roll",
  ],

  frozen: [
    "frozen",
    "ice cream",
    "frozen pea",
    "frozen corn",
    "frozen berry",
    "frozen spinach",
    "puff pastry sheet",
    "phyllo",
    "frozen fruit",
    "ice",
  ],

  household: [
    "paper towel",
    "foil",
    "aluminum foil",
    "parchment paper",
    "plastic wrap",
    "ziploc",
    "napkin",
    "dish soap",
    "sponge",
    "trash bag",
    "toothpick",
    "skewer",
    "cooking spray",
    "nonstick spray",
  ],
};

/**
 * name -> aisle, built once. Flattening the dictionary up front means
 * categorising a row is a handful of map lookups instead of a walk over every
 * keyword in every aisle, which matters on a list screen that re-renders on
 * every tap.
 */
const BY_KEYWORD = new Map<string, string>();
/** Longest keyword in the dictionary, in words. Caps the lookup window. */
let LONGEST = 1;
for (const [aisle, words] of Object.entries(KEYWORDS)) {
  for (const word of words) {
    // First aisle to claim a keyword keeps it, so a word listed twice by
    // mistake behaves predictably rather than depending on object key order.
    if (!BY_KEYWORD.has(word)) BY_KEYWORD.set(word, aisle);
    LONGEST = Math.max(LONGEST, word.split(" ").length);
  }
}

/**
 * Which aisle an ingredient is in.
 *
 * `name` is a normalized key from `normalizeShoppingName` — lowercase and
 * singular, which is the form the dictionary is written in. Matching runs
 * longest phrase first so a specific entry beats a generic one, and only on
 * whole words, so "cornbread" doesn't match "corn".
 */
export function categorizeIngredient(name: string): string {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return OTHER_AISLE;

  for (let size = Math.min(LONGEST, words.length); size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const aisle = BY_KEYWORD.get(words.slice(start, start + size).join(" "));
      if (aisle) return aisle;
    }
  }
  return OTHER_AISLE;
}

/** Where an aisle sits in the walk. Unknown aisles go to the end. */
export function aisleOrder(id: string): number {
  return ORDER.get(id) ?? AISLES.length;
}

/** The header text for an aisle id. */
export function aisleLabel(id: string): string {
  return AISLES.find((aisle) => aisle.id === id)?.label ?? "Other";
}

/**
 * Sort comparator: aisle order first, then the name, so a group is
 * alphabetical inside itself and stays put as things are ticked off.
 */
export function compareByAisle(
  a: { name: string },
  b: { name: string },
): number {
  const byAisle =
    aisleOrder(categorizeIngredient(a.name)) -
    aisleOrder(categorizeIngredient(b.name));
  return byAisle !== 0 ? byAisle : a.name.localeCompare(b.name);
}
