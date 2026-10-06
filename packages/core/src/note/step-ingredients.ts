/**
 * Which ingredients a step uses, for cook mode's "For this step" row.
 *
 * Steps don't link to ingredients in a markdown note, so this is a guess from
 * the words. Strip the quantity and the unit off each ingredient line, then
 * look for what's left in the step, word by word. When the whole name isn't
 * there, the tail of it is tried: steps say "add the onion", not "add the
 * large yellow onion".
 *
 * Every mention in a step goes to one line at most. The most specific name
 * claims it first, so "sesame oil" in a step can't also light up the olive
 * oil. When two lines are equally good - the butter for the filling and the
 * butter for the crumble - the recipe is read top down: the first line no
 * earlier step has used yet wins. A miss just leaves a chip off, which is the
 * cheap way to be wrong.
 */

/** Measures and containers. Stripped along with the number in front. */
const UNITS = [
  "cups?",
  "c",
  "tablespoons?",
  "tbsps?",
  "tbs",
  "teaspoons?",
  "tsps?",
  "ounces?",
  "oz",
  "fl\\.? oz",
  "pounds?",
  "lbs?",
  "grams?",
  "g",
  "kilograms?",
  "kg",
  "milliliters?",
  "millilitres?",
  "ml",
  "liters?",
  "litres?",
  "l",
  "pints?",
  "quarts?",
  "qts?",
  "gallons?",
  "pinch(?:es)?",
  "dash(?:es)?",
  "handfuls?",
  "cloves?",
  "cans?",
  "tins?",
  "jars?",
  "packages?",
  "packets?",
  "pkgs?",
  "sticks?",
  "slices?",
  "bunch(?:es)?",
  "heads?",
  "sprigs?",
  "stalks?",
  "pieces?",
  "knobs?",
  "bags?",
  "boxes?",
  "bottles?",
];

/**
 * Words that describe the thing rather than name it. Off the front of the
 * name, so "1 large yellow onion" reads as "yellow onion".
 */
const DESCRIPTORS = new Set([
  "large",
  "medium",
  "small",
  "big",
  "heaping",
  "level",
  "fresh",
  "freshly",
  "dried",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "grated",
  "ground",
  "crushed",
  "finely",
  "roughly",
  "thinly",
  "packed",
  "softened",
  "melted",
  "cold",
  "warm",
  "whole",
  "boneless",
  "skinless",
  "about",
  "of",
]);

/** Joining words. They never tell two ingredients apart. */
const STOPWORDS = new Set([
  "and",
  "or",
  "of",
  "the",
  "a",
  "an",
  "to",
  "with",
  "for",
  "in",
  "on",
  "into",
  "plus",
]);

/** The end of a line that isn't the ingredient: "salt and pepper to taste". */
const TRAILING =
  /\s+(?:to taste|for (?:serving|garnish(?:ing)?|topping|drizzling|dusting|frying|greasing)|as needed|if needed|optional|(?:plus|or) more\b.*)$/;

// A number in any of the shapes a recipe writes one: 2, 1.5, 1/2, 1 1/2, ½,
// 1½, and ranges like 2-3 or 2 to 3.
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])`;
const QUANTITY = new RegExp(
  String.raw`^(?:${NUMBER}\s*)+(?:(?:-|–|to)\s*(?:${NUMBER}\s*)+)?`,
  "i",
);
const UNIT = new RegExp(String.raw`^(?:${UNITS.join("|")})\.?(?=\s|$)`, "i");

/**
 * The ingredient line as a chip shows it: quantity kept, the trailing prep
 * and any parenthetical dropped. "2 cans (15 oz) chickpeas, drained" comes
 * out as "2 cans chickpeas".
 *
 * The parentheses go before the comma split. Imported notes put the prep
 * inside them - "1 small onion (, diced)" - and splitting first left a stray
 * "(" glued to the name. They nest too: "olive oil ((or preferred oil))".
 */
export function chipText(line: string): string {
  let text = line
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "");
  let before;
  do {
    before = text;
    text = text.replace(/\([^()]*\)/g, " ");
  } while (text !== before);
  return text
    .replace(/[()]/g, " ")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim();
}

/** What's left of a line once the quantity, the unit and the adjectives go. */
export function ingredientName(line: string): string {
  let rest = chipText(line).toLowerCase().replace(TRAILING, "").trim();

  // Strip "2 cans" and "1 tbsp" off the front. Twice over, for the lines that
  // stack them: "1 (14 oz) can" is "1 can" by now, "2 tbsp plus 1 tsp" isn't
  // worth chasing.
  for (let i = 0; i < 2; i++) {
    rest = rest.replace(/^an?\s+/, "");
    rest = rest.replace(QUANTITY, "").trim();
    rest = rest.replace(UNIT, "").trim();
  }

  const words = rest.split(" ").filter((word) => word.length > 0);
  while (words.length > 1 && DESCRIPTORS.has(words[0])) words.shift();
  return words.join(" ");
}

/** "tomatoes" and "tomato" are the same thing on a counter. */
function stem(word: string): string {
  // "bay leaves" and "bay leaf", but not "olives" and "olif".
  if (/(?:ea|oa|l)ves$/.test(word)) return `${word.slice(0, -3)}f`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

type Token = { word: string; start: number; end: number };

/** Stemmed words, with where they sit so punctuation between them shows. */
function tokenize(text: string): Token[] {
  return [...text.toLowerCase().matchAll(/\p{L}+/gu)].map((match) => ({
    word: stem(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

type Line = {
  index: number;
  chip: string;
  /** The name, or each half of "salt and pepper", as stemmed words. */
  names: string[][];
  words: Set<string>;
};

function readLine(line: string, index: number): Line | null {
  const chip = chipText(line);
  const name = ingredientName(line);
  if (!chip || name.length < 3) return null;

  // "salt and pepper" is two things a step mentions separately. "half and
  // half" is one.
  const parts = name
    .split(/\s+(?:and|or|&)\s+|\s*\/\s*/)
    .filter((part) => part.length >= 3);
  const split = parts.length > 1 && new Set(parts).size === parts.length;
  const names = (split ? parts : [name])
    .map((part) => tokenize(part).map((token) => token.word))
    .filter((words) => words.length > 0);
  if (names.length === 0) return null;

  return { index, chip, names, words: new Set(names.flat()) };
}

type Match = {
  line: Line;
  /** How many words of the name the step has, in a row. */
  length: number;
  /** How many it left off the front. */
  missing: number;
  spans: Array<[number, number]>;
};

/**
 * The longest tail of the name the step mentions, and everywhere it does.
 * "yellow onion" tries "yellow onion", then "onion".
 */
function findName(
  text: string,
  tokens: Token[],
  name: string[],
  line: Line,
  telling: Set<string>,
): Match | null {
  // Whitespace or a hyphen between two words, not a comma or a full stop.
  const joined = (a: number, b: number) =>
    /^[\s-]*$/.test(text.slice(tokens[a].end, tokens[b].start));

  for (let length = name.length; length >= 1; length--) {
    const tail = name.slice(name.length - length);
    const partial = length < name.length;
    if (partial && tail.join("").length < 3) continue;

    const spans: Array<[number, number]> = [];
    for (let at = 0; at + length <= tokens.length; at++) {
      const hit = tail.every(
        (word, j) =>
          tokens[at + j].word === word && (j === 0 || joined(at + j - 1, at + j)),
      );
      if (!hit) continue;

      // Half a name is only a match when the step isn't naming something
      // else. "sesame oil" is not the olive oil, and "lemon juice" is not
      // the lemon zest, when the recipe has both.
      if (partial) {
        const before = at > 0 && joined(at - 1, at) ? tokens[at - 1] : null;
        const after =
          at + length < tokens.length && joined(at + length - 1, at + length)
            ? tokens[at + length]
            : null;
        const other = (token: Token | null) =>
          token !== null &&
          telling.has(token.word) &&
          !line.words.has(token.word);
        if (other(before) || other(after)) continue;
      }
      spans.push([at, at + length]);
    }

    if (spans.length > 0) {
      return { line, length, missing: name.length - length, spans };
    }
  }
  return null;
}

/**
 * The ingredient lines each step mentions, in the order the recipe lists
 * them, ready to draw as chips. Worked out for the whole recipe at once,
 * because which butter a step means depends on the steps before it.
 */
export function ingredientsForSteps(
  steps: string[],
  ingredients: string[],
): string[][] {
  const lines = ingredients
    .map(readLine)
    .filter((line): line is Line => line !== null);

  // Words that name one ingredient apart from another: "sesame", "juice".
  const descriptors = new Set([...DESCRIPTORS].map(stem));
  const telling = new Set(
    lines
      .flatMap((line) => [...line.words])
      .filter((word) => !STOPWORDS.has(word) && !descriptors.has(word)),
  );

  const used = new Set<number>();

  return steps.map((step) => {
    const tokens = tokenize(step);
    const matches: Match[] = [];
    for (const line of lines) {
      for (const name of line.names) {
        const match = findName(step, tokens, name, line, telling);
        if (match) matches.push(match);
      }
    }

    // The whole name beats part of one, and more words beat fewer. Then the
    // recipe's order, which reads differently for the two:
    //
    // Two lines with the same whole name are two separate amounts - the
    // filling's butter and the crumble's. The first one no earlier step has
    // used is next; once they all have been, the one furthest down.
    //
    // Part of a name is the step pointing back at something already in the
    // pot. "Simmer until the potatoes are tender" is the russets from two
    // steps ago, not the cooked potato saved for the garnish.
    matches.sort((a, b) => {
      const whole = Number(b.missing === 0) - Number(a.missing === 0);
      if (whole !== 0) return whole;
      if (a.length !== b.length) return b.length - a.length;
      const aUsed = used.has(a.line.index);
      const bUsed = used.has(b.line.index);
      if (a.missing === 0) {
        if (aUsed !== bUsed) return aUsed ? 1 : -1;
        return aUsed
          ? b.line.index - a.line.index
          : a.line.index - b.line.index;
      }
      if (a.missing !== b.missing) return a.missing - b.missing;
      if (aUsed !== bUsed) return aUsed ? -1 : 1;
      return a.line.index - b.line.index;
    });

    const claimed = new Array<boolean>(tokens.length).fill(false);
    const free = ([from, to]: [number, number]) =>
      claimed.slice(from, to).every((taken) => !taken);
    const taken = new Set<number>();

    for (const match of matches) {
      if (taken.has(match.line.index) || !match.spans.some(free)) continue;
      taken.add(match.line.index);
      // Every mention this line has in the step is its now, so "melt the
      // butter, then brush on the butter" doesn't pull in a second butter.
      for (const other of matches) {
        if (other.line !== match.line) continue;
        for (const span of other.spans) {
          if (free(span)) claimed.fill(true, span[0], span[1]);
        }
      }
    }

    for (const index of taken) used.add(index);

    const chips: string[] = [];
    for (const line of lines) {
      if (taken.has(line.index) && !chips.includes(line.chip)) {
        chips.push(line.chip);
      }
    }
    return chips;
  });
}

/** One step on its own, with no earlier steps to read the order from. */
export function ingredientsForStep(
  step: string,
  ingredients: string[],
): string[] {
  return ingredientsForSteps([step], ingredients)[0];
}
