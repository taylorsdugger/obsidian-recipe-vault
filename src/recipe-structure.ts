/**
 * Where the parts of a recipe note sit, by line, read straight from the note's
 * text. The reading-view layout tags each rendered section with its role from
 * this, the rail slices the hero and ingredients out of it, and cook mode
 * takes its steps from it.
 *
 * Kept free of Obsidian so it can be tested on plain strings.
 */

export type RecipeSectionRole =
  | "hero"
  | "meta"
  | "ingredients"
  | "instructions"
  | "notes";

/** Lines `[start, end)` of the note, zero-based like Obsidian's. */
export interface LineRange {
  start: number;
  end: number;
}

export interface RecipeOutline {
  /** The first image embed before the ingredients, as its own paragraph. */
  hero: LineRange | null;
  /** The `> [!recipe-meta]` callout. */
  meta: LineRange | null;
  /** Each heading's range runs from its own line to the next heading at the same level or higher. */
  ingredients: LineRange | null;
  instructions: LineRange | null;
  notes: LineRange | null;
  /** The line the note's action buttons go after. */
  actionsAnchor: number | null;
}

interface Heading {
  line: number;
  level: number;
  text: string;
}

const IMAGE_LINE = /^\s*(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\))\s*$/;
const META_LINE = /^\s*>\s*\[!recipe-meta\]/i;
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\].*)$/;

function scanHeadings(lines: string[]): { headings: Heading[]; body: number } {
  const headings: Heading[] = [];
  let i = 0;
  // Front matter is only front matter on the very first line.
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex(
      (l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l),
    );
    if (close > 0) i = close + 1;
  }
  const body = i;
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const mark = fenceMatch[1][0];
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) headings.push({ line: i, level: m[1].length, text: m[2] });
  }
  return { headings, body };
}

function headingRange(
  headings: Heading[],
  match: RegExp,
  total: number,
): LineRange | null {
  const index = headings.findIndex((h) => match.test(h.text));
  if (index < 0) return null;
  const heading = headings[index];
  const next = headings.slice(index + 1).find((h) => h.level <= heading.level);
  return { start: heading.line, end: next ? next.line : total };
}

/** The paragraph or callout around `line`: its run of non-blank lines. */
function blockAround(lines: string[], line: number): LineRange {
  let end = line + 1;
  while (end < lines.length && lines[end].trim() !== "") end++;
  return { start: line, end };
}

export function recipeOutline(markdown: string): RecipeOutline {
  const lines = markdown.split("\n");
  const { headings, body } = scanHeadings(lines);
  const ingredients = headingRange(headings, /\bingredients?\b/i, lines.length);
  const instructions = headingRange(
    headings,
    /\b(instructions|directions|method|steps|preparation)\b/i,
    lines.length,
  );
  const notes = headingRange(headings, /^notes?\b/i, lines.length);

  // The hero and the callout belong to the top of the note, so they're only
  // looked for above the first of the recipe's own headings.
  const topEnd = Math.min(
    ...[ingredients, instructions, notes]
      .filter((r): r is LineRange => r !== null)
      .map((r) => r.start),
    lines.length,
  );
  let hero: LineRange | null = null;
  let meta: LineRange | null = null;
  for (let i = body; i < topEnd; i++) {
    if (!hero && IMAGE_LINE.test(lines[i])) hero = blockAround(lines, i);
    if (!meta && META_LINE.test(lines[i])) meta = blockAround(lines, i);
  }

  // The buttons go under the callout, or under whatever sits last above the
  // ingredients. Not under the hero, since the rail hides it on a wide pane.
  let actionsAnchor: number | null = meta ? meta.end - 1 : null;
  if (actionsAnchor === null && ingredients) {
    for (let i = ingredients.start - 1; i >= body; i--) {
      if (lines[i].trim() === "") continue;
      if (hero && i >= hero.start && i < hero.end) continue;
      actionsAnchor = i;
      break;
    }
  }
  if (actionsAnchor === null) actionsAnchor = hero ? hero.end - 1 : null;

  return { hero, meta, ingredients, instructions, notes, actionsAnchor };
}

function overlaps(range: LineRange | null, start: number, end: number) {
  return range !== null && start < range.end && end >= range.start;
}

/**
 * The role of a rendered section, from its line span (`lineEnd` inclusive, as
 * `getSectionInfo` gives it). Null for anything the layout leaves alone, like
 * the title and description.
 */
export function sectionRole(
  outline: RecipeOutline,
  lineStart: number,
  lineEnd: number,
): RecipeSectionRole | null {
  if (overlaps(outline.hero, lineStart, lineEnd)) return "hero";
  if (overlaps(outline.meta, lineStart, lineEnd)) return "meta";
  for (const role of ["ingredients", "instructions", "notes"] as const) {
    const range = outline[role];
    if (range && lineStart >= range.start && lineStart < range.end) return role;
  }
  return null;
}

/** Whether a section spanning these lines is where the action buttons go. */
export function holdsActions(
  outline: RecipeOutline,
  lineStart: number,
  lineEnd: number,
): boolean {
  const anchor = outline.actionsAnchor;
  return anchor !== null && anchor >= lineStart && anchor <= lineEnd;
}

/** The text of a range, without its heading line when it starts with one. */
export function sliceBody(
  markdown: string,
  range: LineRange,
  dropHeading = true,
): { text: string; firstLine: number } {
  const lines = markdown.split("\n");
  const first = dropHeading ? range.start + 1 : range.start;
  let end = range.end;
  // Trailing blanks and a closing rule are layout, not content.
  while (end > first && /^\s*(([-*_])(\s*\2){2,})?\s*$/.test(lines[end - 1])) {
    end--;
  }
  return { text: lines.slice(first, end).join("\n"), firstLine: first };
}

/** File lines of each task item in a range, in order. */
export function taskLines(markdown: string, range: LineRange): number[] {
  const lines = markdown.split("\n");
  const found: number[] = [];
  for (let i = range.start; i < Math.min(range.end, lines.length); i++) {
    if (TASK_LINE.test(lines[i])) found.push(i);
  }
  return found;
}

/** How many task items in the range are ticked. */
export function countChecked(markdown: string, range: LineRange): number {
  const lines = markdown.split("\n");
  return taskLines(markdown, range).filter(
    (i) => TASK_LINE.exec(lines[i])?.[2] !== " ",
  ).length;
}

/** Set one task line ticked or not. Leaves the text alone if it isn't a task. */
export function setTaskLine(
  markdown: string,
  line: number,
  checked: boolean,
): string {
  const lines = markdown.split("\n");
  const m = TASK_LINE.exec(lines[line] ?? "");
  if (!m) return markdown;
  const current = m[2] !== " ";
  if (current === checked) return markdown;
  lines[line] = `${m[1]}${checked ? "x" : " "}${m[3]}`;
  return lines.join("\n");
}

/** Ingredient lines, without their list markers and checkboxes. */
export function ingredientLines(markdown: string, range: LineRange): string[] {
  const { text } = sliceBody(markdown, range);
  return text
    .split("\n")
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s*)?(.*)$/.exec(l)?.[1])
    .filter((l): l is string => !!l && l.trim() !== "")
    .map((l) => l.trim());
}

export interface CookStep {
  /** The step as written, still markdown. */
  text: string;
  /** The `####` heading it sits under, if any. */
  group: string;
}

/**
 * Flatten the instructions into steps, in order. Each top-level list item or
 * paragraph is a step; an indented line belongs to the step above it.
 */
export function cookSteps(markdown: string, range: LineRange): CookStep[] {
  const { text } = sliceBody(markdown, range);
  const steps: CookStep[] = [];
  let group = "";
  let lastWasBlank = true;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") {
      lastWasBlank = true;
      continue;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) {
      group = heading[1];
      lastWasBlank = true;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) continue;
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    const previous = steps[steps.length - 1];
    if (item) {
      steps.push({ text: item[1].trim(), group });
    } else if (previous && (/^\s/.test(raw) || !lastWasBlank)) {
      // An indented sub-point or a wrapped paragraph line.
      const sub = raw.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "");
      previous.text = `${previous.text} ${sub}`;
    } else {
      steps.push({ text: raw.trim(), group });
    }
    lastWasBlank = false;
  }
  return steps.filter((s) => s.text !== "");
}

/**
 * Take the ticked ingredients off the note: their text, and the note with
 * them unticked. Only the ingredients range is touched, so a ticked task in
 * the notes stays ticked.
 */
export function takeCheckedIngredients(markdown: string): {
  text: string;
  checked: string[];
} {
  const range = recipeOutline(markdown).ingredients;
  if (!range) return { text: markdown, checked: [] };
  const lines = markdown.split("\n");
  const checked: string[] = [];
  for (const i of taskLines(markdown, range)) {
    const m = TASK_LINE.exec(lines[i]);
    if (!m || m[2] === " ") continue;
    checked.push(m[3].slice(1).trim());
    lines[i] = `${m[1]} ${m[3]}`;
  }
  return { text: lines.join("\n"), checked };
}
