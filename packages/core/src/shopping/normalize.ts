/**
 * Turning what a recipe wrote into what you buy.
 *
 * A week of eight recipes puts "1 large onion", "2 yellow onions, diced" and
 * "1 medium red onion, thinly sliced" on the same list as three rows, because
 * the merge keys on the name and those are three different strings. This
 * module reduces a name to the thing on the shelf, so the merge can add them
 * up.
 *
 * Two rules keep it honest:
 *
 * 1. Nothing is thrown away. Every word this strips off comes back as a
 *    `qualifier`, so the row can read "3 onions" with "large · yellow" under
 *    it. That is what makes it safe to be this aggressive — the cook can still
 *    see that one of them was meant to be red.
 *
 * 2. It only folds together things you would buy off the same shelf. Yellow,
 *    white and sweet onions are interchangeable, so they fold - by name, in
 *    `ALIASES`, never by stripping the colour, because "brown sugar" is not
 *    sugar and "sweet potato" is not potato. A red onion doesn't fold at all.
 *    Same for dried vs fresh herbs, and for crushed vs diced tomatoes - those
 *    are different cans.
 */

import { normalizeIngredientUnit } from "./parse-line";

export interface NormalizedName {
  /** The merge key. Canonical, singular, no descriptors. */
  key: string;
  /** Words lifted off the name, in the order they were seen. */
  qualifiers: string[];
  /** Whether the line wrote the head noun as a plural ("peas", "oats"). */
  plural: boolean;
  /** Something you already have. Water, mostly. Kept off generated lists. */
  pantry: boolean;
  /**
   * Nothing survived that names a thing to buy - the line was "chopped", or a
   * stray "s" a site's markup left behind. The caller shows the original line
   * instead, because a row you can read and fix beats a row that says "2 s".
   */
  meaningless: boolean;
}

/**
 * Words that change nothing about which package you pick up. Removed from the
 * name and kept as qualifiers, so "large" still shows on the row.
 */
const QUALIFIER_WORDS = new Set([
  // Size and grade.
  "large",
  "medium",
  "small",
  "jumbo",
  // Sourcing. A preference rather than a different product, but one worth
  // still seeing on the row.
  "organic",
  // Salt and fat levels. You do buy these on purpose, so they stay visible.
  "unsalted",
  "salted",
  // Prep-adjacent grades that never change the product.
  "ripe",
  "firm",
  "seedless",
  "boneless",
  "skinless",
  "thick",
  "thin",
  "block",
  "bulk",
]);

/**
 * Qualifiers that are two words. Matched and lifted whole, before anything is
 * tokenised, because "low, sodium" under a row of broth reads like a mistake
 * and "low sodium" reads like a shelf.
 */
const QUALIFIER_PHRASES: [RegExp, string][] = [
  [/\blow[\s-]sodium\b/g, "low sodium"],
  [/\breduced[\s-]sodium\b/g, "low sodium"],
  [/\blow[\s-]fat\b/g, "low fat"],
  [/\bnon[\s-]?fat\b/g, "nonfat"],
  [/\bfat[\s-]free\b/g, "fat free"],
  [/\bextra[\s-]large\b/g, "extra large"],
  [/\bfree[\s-]range\b/g, "free range"],
  [/\bpasture[\s-]raised\b/g, "pasture raised"],
  [/\bgrass[\s-]fed\b/g, "grass fed"],
];

/**
 * Words that describe what you do to the ingredient after you get it home.
 * Removed outright — nobody needs "minced" on a shopping list.
 */
const PREP_WORDS = new Set([
  // Adverbs. These only ever modify a prep verb.
  "freshly",
  "finely",
  "thinly",
  "thickly",
  "roughly",
  "coarsely",
  "lightly",
  "firmly",
  "tightly",
  "loosely",
  "evenly",
  "very",
  "well",
  "about",
  "approximately",
  "generous",
  "heaping",
  "scant",
  "level",
  "packed",
  // Prep verbs. The store does none of these for you.
  "chopped",
  "diced",
  "minced",
  "sliced",
  "cubed",
  "julienned",
  "halved",
  "quartered",
  "peeled",
  "cored",
  "seeded",
  "deseeded",
  "stemmed",
  "destemmed",
  "trimmed",
  "rinsed",
  "washed",
  "drained",
  "torn",
  "beaten",
  "melted",
  "softened",
  "divided",
  "separated",
  "pitted",
  "zested",
  "juiced",
  "mashed",
  "pureed",
  "warmed",
  "chilled",
  "thawed",
  "optional",
  "room",
  "temperature",
  // Grade words with nothing behind them. "extra" only ever belongs to a
  // phrase ("extra large", "extra virgin") and those are handled elsewhere.
  "extra",
  "xl",
  "quality",
  "good",
  "best",
  "cheap",
  "nice",
  "low",
  "reduced",
  "sodium",
  "lite",
  "free",
  "range",
  "pasture",
  "raised",
  "lukewarm",
  "cold",
  "warm",
  "hot",
  // Glue.
  "of",
  "the",
  "a",
  "an",
  "and",
  "plus",
  "more",
  "your",
  "own",
  "some",
  "any",
  "into",
  "in",
  "cut",
  "for",
  "as",
  "if",
  "to",
  "taste",
  "needed",
  "desired",
  "serving",
  "garnish",
]);

/**
 * Two-word phrases where the leading prep word is the product, not an
 * instruction. "diced tomatoes" is a specific can and "tomatoes" is not it;
 * "2 cups diced onion" is still just onion. The pair is what tells them apart,
 * so the exemption is written as a pair.
 *
 * Keyed with the second word singular, which is the form the comparison uses.
 */
const PREP_KEEPS_PAIR = new Set([
  "diced tomato",
  "diced green",
  "chopped tomato",
  "chopped spinach",
  "sliced almond",
  "sliced olive",
  "sliced mushroom",
]);

/**
 * Words that look like padding but pick out a different product. Never
 * stripped. Kept here as the note explaining why they are missing above.
 *
 * "ground beef" is not beef, "whole milk" is not milk, "dried basil" is not
 * basil, and "crushed tomatoes", "diced tomatoes" and "tomato puree" are three
 * separate cans.
 */
const NEVER_STRIP = new Set([
  "ground",
  "whole",
  "dried",
  "dry",
  "fresh",
  "frozen",
  "canned",
  "jarred",
  "crushed",
  "shredded",
  "grated",
  "smoked",
  "roasted",
  "toasted",
  "raw",
  "sweetened",
  "unsweetened",
  "instant",
  "quick",
  "self",
  "rising",
  "red",
  "green",
  "black",
  "purple",
  "wild",
  "baby",
  "mini",
  "heavy",
  "light",
  "double",
  "half",
  "vegan",
  "vegetarian",
  /*
   * Colours, which are the trap here. "yellow onion" is an onion, but "brown
   * sugar" is not sugar, "white rice" is not rice and "sweet potato" is very
   * much not potato. So no colour is ever stripped as padding - the specific
   * cases that do fold onto one shelf are spelled out in `ALIASES` instead.
   */
  "yellow",
  "white",
  "brown",
  "sweet",
  "spanish",
  "vidalia",
]);

/**
 * Names that fold onto one shelf. The left side is what a recipe wrote, the
 * right side is what you look for.
 *
 * Matched after the name has already been stripped and singularised, so one
 * entry covers several ways of writing it — "low-sodium vegetable stock" and
 * "veggie stock" both arrive here as "vegetable stock".
 *
 * This is data. Add a line when a week's shop turns up a pair that should have
 * merged and didn't.
 */
const ALIASES: Record<string, string> = {
  // Salt and pepper. Every recipe writes these differently and it is always
  // the same box.
  "kosher salt": "salt",
  "sea salt": "salt",
  "table salt": "salt",
  "flaky salt": "salt",
  "flaky sea salt": "salt",
  "coarse salt": "salt",
  "fine salt": "salt",
  "fine sea salt": "salt",
  "ground black pepper": "black pepper",
  "cracked black pepper": "black pepper",
  pepper: "black pepper",
  "ground pepper": "black pepper",

  // Oils.
  "virgin olive oil": "olive oil",
  evoo: "olive oil",
  "canola oil": "vegetable oil",
  "neutral oil": "vegetable oil",

  // Stock and broth are the same aisle and the same recipe slot.
  "vegetable stock": "vegetable broth",
  "veggie broth": "vegetable broth",
  "veggie stock": "vegetable broth",
  "chicken stock": "chicken broth",
  "beef stock": "beef broth",
  "mushroom stock": "mushroom broth",

  // Alliums. Yellow, white and sweet fold; red and green do not.
  "yellow onion": "onion",
  "white onion": "onion",
  "brown onion": "onion",
  "sweet onion": "onion",
  "spanish onion": "onion",
  "vidalia onion": "onion",
  "garlic clove": "garlic",
  "clove garlic": "garlic",
  "garlic bulb": "garlic",
  "green onion": "scallion",
  "spring onion": "scallion",

  // Herbs, where two names mean one bunch.
  "coriander leaf": "cilantro",
  "fresh coriander": "cilantro",
  "italian parsley": "parsley",
  "flat leaf parsley": "parsley",

  // Baking staples.
  "all purpose flour": "flour",
  "ap flour": "flour",
  "plain flour": "flour",
  "granulated sugar": "sugar",
  "white sugar": "sugar",
  "caster sugar": "sugar",
  "light brown sugar": "brown sugar",
  "dark brown sugar": "brown sugar",
  "bicarbonate soda": "baking soda",
  "bicarb soda": "baking soda",

  // Dairy.
  "heavy whipping cream": "heavy cream",
  "double cream": "heavy cream",
  "parmigiano reggiano": "parmesan",

  // Odds and ends that show up under two names.
  chickpea: "chickpeas",
  "garbanzo bean": "chickpeas",
  garbanzo: "chickpeas",
  "corn starch": "cornstarch",
  "corn flour": "cornstarch",
  tamari: "soy sauce",
  nooch: "nutritional yeast",
};

/**
 * Lines that are two ingredients wearing one coat. Only the pairs that are
 * never anything else — "salt and pepper" is two things, "macaroni and cheese"
 * is one, so this cannot be a general rule about the word "and".
 *
 * Keyed on the stripped form, after "and" and any adverbs are gone, so one
 * entry covers "salt and pepper", "salt & pepper" and "salt and freshly
 * ground pepper".
 */
const PAIRS: Record<string, string[]> = {
  "salt pepper": ["salt", "black pepper"],
  "salt black pepper": ["salt", "black pepper"],
  "salt ground pepper": ["salt", "black pepper"],
  "salt ground black pepper": ["salt", "black pepper"],
  "pepper salt": ["black pepper", "salt"],
  "black pepper salt": ["black pepper", "salt"],
  "oil vinegar": ["olive oil", "vinegar"],
};

/** Already in the tap. Kept off a generated list entirely. */
const PANTRY = new Set([
  "water",
  "ice",
  "ice cube",
  "ice water",
  "tap water",
  "filtered water",
  "boiling water",
  "warm water",
  "hot water",
  "cold water",
]);

/**
 * Words ending in s that are not plurals. Singularising these gives "hummu"
 * and "asparagu", which then fail to match anything.
 */
const NOT_PLURAL = new Set([
  "hummus",
  "couscous",
  "asparagus",
  "molasses",
  "watercress",
  "swiss",
  "bass",
  "grits",
  "oats",
  "brussels",
  "chips",
  "greens",
  "sprouts",
  "chickpeas",
  "capers",
  "grapes",
]);

/**
 * Things you don't count, so a row of them never gets an s. "2 sticks butter"
 * is two sticks of butter, not two butters, and a soup wanting 3 cups of
 * water does not want "waters".
 */
const MASS_NOUNS = new Set([
  "water",
  "butter",
  "flour",
  "sugar",
  "salt",
  "pepper",
  "rice",
  "milk",
  "cream",
  "oil",
  "broth",
  "stock",
  "cheese",
  "yogurt",
  "honey",
  "vinegar",
  "garlic",
  "ginger",
  "spinach",
  "kale",
  "cilantro",
  "parsley",
  "basil",
  "beef",
  "pork",
  "chicken",
  "bacon",
  "bread",
  "pasta",
  "quinoa",
  "cinnamon",
  "cumin",
  "paprika",
  "syrup",
  "sauce",
  "juice",
  "wine",
  "tofu",
  "cornstarch",
  "jackfruit",
  "coconut",
  "chocolate",
  "cocoa",
  "vanilla",
  "mayonnaise",
  "mustard",
  "ketchup",
  "hummus",
  "tahini",
  "miso",
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  leaves: "leaf",
  loaves: "loaf",
  halves: "half",
  knives: "knife",
  potatoes: "potato",
  tomatoes: "tomato",
  mangoes: "mango",
  avocados: "avocado",
  chilies: "chili",
  chillies: "chili",
  chiles: "chile",
  berries: "berry",
  cherries: "cherry",
  anchovies: "anchovy",
  scallions: "scallion",
};

/** Plurals this writes back out, for the ones the naive rule gets wrong. */
const IRREGULAR_SINGULARS: Record<string, string> = {
  leaf: "leaves",
  loaf: "loaves",
  half: "halves",
  potato: "potatoes",
  tomato: "tomatoes",
  mango: "mangoes",
  chili: "chilies",
  chile: "chiles",
  berry: "berries",
  cherry: "cherries",
  anchovy: "anchovies",
};

/**
 * "jalapeños" -> "jalapenos", "crème fraîche" -> "creme fraiche".
 *
 * The tokeniser keeps only a-z0-9, so without this an accented letter is
 * deleted rather than folded and the name comes out as "jalapeos" - which
 * matches nothing in the aisle dictionary and reads like a typo on the row.
 */
function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** "onions" -> "onion". Leaves anything it isn't sure about alone. */
export function singulariseName(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (NOT_PLURAL.has(word) || word.length < 4) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** "onion" -> "onions", for a row whose count says so. */
export function pluraliseName(word: string): string {
  if (IRREGULAR_SINGULARS[word]) return IRREGULAR_SINGULARS[word];
  if (MASS_NOUNS.has(word) || NOT_PLURAL.has(word) || word.endsWith("s")) {
    return word;
  }
  if (/(ch|sh|ss|x|z)$/.test(word)) return word + "es";
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

/**
 * Whether the line's head noun was written plural. Only the last word matters:
 * "2 cups rolled oats" is plural, "1 large onion" is not.
 */
function looksPlural(tokens: string[]): boolean {
  const head = tokens[tokens.length - 1];
  if (!head) return false;
  return singulariseName(head) !== head;
}

/**
 * Trailing phrases that belong to the recipe, not the shop. Cut before
 * tokenising so their words can't be mistaken for part of the name.
 */
const TRAILING_NOTE =
  /\s*\b(?:to taste|or to taste|as needed|as desired|if needed|if desired|if using|plus more\b.*|for (?:serving|garnish|garnishing|topping|drizzling|brushing|greasing|frying|dusting|the pan)\b.*|divided|optional|in (?:water|juice|brine|syrup|oil|its own juice))\b\.?\s*/g;

/**
 * Cut an " or ..." alternative, but only when what comes before it can stand
 * on its own.
 *
 * "vegan chicken broth or vegetable broth" is a choice between two things, so
 * the first one wins. "chicken or vegetable broth" is one thing written two
 * ways and cutting at "or" would leave "chicken", which is a different aisle.
 * Two words before the "or" is the line between those.
 */
function dropAlternative(text: string): string {
  const at = text.search(/\s+\bor\b\s+/);
  if (at === -1) return text;
  const before = text.slice(0, at).trim();
  return before.split(/\s+/).length >= 2 ? before : text;
}

/**
 * Reduce an ingredient name to what you buy.
 *
 * `raw` is the name as `parseShoppingLine` leaves it: lowercased, with
 * parentheticals and anything after the first comma already gone.
 */
export function normalizeShoppingName(raw: string): NormalizedName {
  let cleaned = dropAlternative(
    foldAccents(raw.toLowerCase())
      .replace(/["'‘’“”*]/g, "")
      // "arugula/rocket" is one leaf with two names. Same call as an " or ",
      // but a slash never separates two different things to buy.
      .replace(/([a-z]{2,})\/[a-z]+/g, "$1")
      .replace(TRAILING_NOTE, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

  // Two-word qualifiers come off first, whole, so tokenising can't split them.
  // Replace and compare rather than `test`, which on a /g regex leaves
  // `lastIndex` behind and makes the next name's match depend on this one's.
  const phrases: string[] = [];
  for (const [re, label] of QUALIFIER_PHRASES) {
    const next = cleaned.replace(re, " ");
    if (next !== cleaned) {
      cleaned = next;
      if (!phrases.includes(label)) phrases.push(label);
    }
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const tokens = cleaned
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  const qualifiers: string[] = [...phrases];
  const kept: string[] = [];
  tokens.forEach((token, i) => {
    const next = tokens[i + 1];
    if (NEVER_STRIP.has(token)) {
      kept.push(token);
    } else if (
      PREP_WORDS.has(token) &&
      !(next && PREP_KEEPS_PAIR.has(`${token} ${singulariseName(next)}`))
    ) {
      // Dropped without a trace. "minced" tells you nothing at the shop.
    } else if (QUALIFIER_WORDS.has(token)) {
      if (!qualifiers.includes(token)) qualifiers.push(token);
    } else {
      kept.push(token);
    }
  });

  // Everything was padding. Fall back to the cleaned name so the row still
  // says something.
  if (kept.length === 0) {
    // Every word was padding: "chopped", "to taste", "finely". There is no
    // ingredient in here to name.
    const fallback = cleaned || raw.trim().toLowerCase();
    return {
      key: fallback,
      qualifiers,
      plural: false,
      pantry: false,
      meaningless: true,
    };
  }

  const plural = looksPlural(kept);
  kept[kept.length - 1] = singulariseName(kept[kept.length - 1]);

  const joined = kept.join(" ");
  const key = ALIASES[joined] ?? joined;
  if (key !== joined) addAliasQualifiers(joined, key, qualifiers);

  return {
    key,
    qualifiers,
    plural,
    pantry: PANTRY.has(key),
    // A single letter is never an ingredient. It is what is left when a
    // site's markup puts the name in a span this parser never saw, and it is
    // where the "2 s" rows came from.
    meaningless: key.length < 2,
  };
}

/**
 * Hand back the words an alias dropped, when they were only describing the
 * thing rather than renaming it.
 *
 * "yellow onion" -> "onion" dropped an adjective, and the row is better for
 * saying "yellow". "garlic clove" -> "garlic" and "vegetable stock" ->
 * "vegetable broth" renamed the noun, and "clove" or "stock" under a row would
 * be noise. The head noun surviving the alias is what tells those apart.
 */
function addAliasQualifiers(
  before: string,
  after: string,
  qualifiers: string[],
): void {
  const head = (text: string) => text.split(" ").at(-1);
  if (head(before) !== head(after)) return;

  const keptWords = new Set(after.split(" "));
  for (const word of before.split(" ")) {
    if (!keptWords.has(word) && !qualifiers.includes(word)) {
      qualifiers.push(word);
    }
  }
}

/**
 * Split a name that is really two ingredients. Returns null for the normal
 * case of one.
 */
export function splitPairedName(key: string): string[] | null {
  return PAIRS[key] ?? null;
}

/**
 * Something the kitchen already has. Kept off a list built from recipes — a
 * week of soups otherwise asks you to buy five cups of water — but not off one
 * you typed yourself, because if you ask for water you want water.
 */
export function isPantryStaple(key: string): boolean {
  return PANTRY.has(key);
}

/**
 * Pull a unit out of the name when the line didn't put one in front.
 *
 * "3 garlic cloves" parses as three of something called "garlic cloves",
 * while "4 cloves garlic" parses as four cloves of garlic. They are the same
 * shopping item, so a unit on either end of the name moves to where the
 * leading one would have been. The other common shape is a size that came
 * wrapped in parentheses - "1 (28 oz) can crushed tomatoes" loses the "(28
 * oz)" to the note and leaves "can" stranded at the front of the name.
 *
 * Only when something is left over that is an actual ingredient: "2 whole
 * cloves" is the spice, and lifting its "cloves" would leave a row called
 * "whole".
 */
export function liftEmbeddedUnit(
  name: string,
): { name: string; unit: string } | null {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  for (const end of ["last", "first"] as const) {
    const i = end === "last" ? tokens.length - 1 : 0;
    const unit = normalizeIngredientUnit(tokens[i]);
    if (!unit) continue;

    const rest = end === "last" ? tokens.slice(0, -1) : tokens.slice(1);
    const informative = rest.filter(
      (t) =>
        !QUALIFIER_WORDS.has(t) && !PREP_WORDS.has(t) && !NEVER_STRIP.has(t),
    );
    if (informative.length === 0) continue;

    return { name: rest.join(" "), unit };
  }
  return null;
}

/**
 * Whether a prep note is worth keeping.
 *
 * "diced" is. "to taste", "divided" and "or vegetable broth" are the recipe
 * talking to the cook, and they end up in the note only because they sat
 * behind a comma or inside parentheses.
 */
export function cleanPrepNote(note: string): string {
  const text = note.toLowerCase().trim();
  if (/^or\b/.test(text)) return "";
  // "2 orange(s)" - a parenthesised plural marker, not a note.
  if (text === "s" || text === "es") return "";
  const stripped = text.replace(TRAILING_NOTE, " ").replace(/\s+/g, " ").trim();
  return stripped.replace(/^[,\s.]+|[,\s.]+$/g, "");
}

/**
 * How the row reads on the list.
 *
 * The key is singular so it can match; the display follows the count. A
 * countable row says "3 onions" and "1 onion", and a measured row keeps
 * whatever the recipe wrote, because "1 cup pea" is nobody's shopping list.
 */
export function displayName(
  key: string,
  amount: number,
  unit: string,
  plural: boolean,
): string {
  const words = key.split(" ");
  const head = words[words.length - 1];
  const wantPlural = unit === "" ? amount > 1 : plural;
  words[words.length - 1] = wantPlural
    ? pluraliseName(head)
    : singulariseName(head);
  return words.join(" ");
}
