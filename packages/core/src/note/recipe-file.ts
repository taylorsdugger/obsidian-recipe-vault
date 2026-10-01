import { cooklangToJsonLd, parseCooklang } from "../parse/cooklang";
import {
  cookTimeToMinutes,
  readFrontmatter,
  setFrontmatterValues,
} from "./frontmatter";
import {
  findMarkdownSection,
  parseRecipeSections,
  parseSectionList,
} from "./sections";

/**
 * The two kinds of file a recipe can live in. A markdown note made from the
 * template, or a Cooklang `.cook` file.
 */
export type RecipeFormat = "markdown" | "cooklang";

/** The format a path holds by its extension, or null for anything else. */
export function recipeFormatOf(path: string): RecipeFormat | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md") return "markdown";
  if (ext === "cook") return "cooklang";
  return null;
}

/** "Recipes/Pie (2).cook" → "Pie (2)". */
function basename(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * What the gallery, search and the web app need from a recipe, read the same
 * way whichever format it's in. Empty strings mean "not set".
 */
export interface RecipeFileSummary {
  format: RecipeFormat;
  /** False for a note or file with no ingredients or steps in it. */
  isRecipe: boolean;
  title: string;
  author: string;
  sourceUrl: string;
  /** The photo as the file writes it: a url, a vault path, or a wikilink. */
  photo: string;
  /** Comma-separated, like the note's `meal_type`. */
  mealType: string;
  /** Readable, like "1h 30m". */
  cookTime: string;
  cookTimeMins: number | null;
  timesMade: number;
  lastMade: string;
  /** `date_added`, when the file has one. */
  dateAdded: string;
  /**
   * The vault file a folder import made this from (`source_file` in a note,
   * `source file` in a `.cook` file), so a second run can skip it.
   */
  sourceFile: string;
  ingredients: string[];
  instructions: string[];
  notes: string[];
}

function count(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The note's `# [Name](url)` heading, or a plain `# Name`. */
function titleFromHeading(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m);
  if (!heading) return "";
  const link = heading[1].match(/^\[(.+?)\]\(.*\)$/);
  return (link ? link[1] : heading[1]).trim();
}

function readMarkdown(path: string, text: string): RecipeFileSummary {
  const fm = readFrontmatter(text);
  const sections = parseRecipeSections(text);
  const notesRange = findMarkdownSection(text, "Notes");
  const cookTime = (fm.cook_time ?? "").trim();
  return {
    format: "markdown",
    isRecipe: sections !== null,
    title: titleFromHeading(text) || basename(path),
    author: (fm.author ?? "").trim(),
    sourceUrl: (fm.url ?? "").trim(),
    photo: (fm.photo ?? "").trim(),
    mealType: (fm.meal_type ?? "").trim(),
    cookTime,
    cookTimeMins: cookTimeToMinutes(cookTime || undefined),
    timesMade: count(fm.times_made),
    lastMade: (fm.last_made ?? "").trim(),
    dateAdded: (fm.date_added ?? "").trim(),
    sourceFile: (fm.source_file ?? "").trim(),
    ingredients: sections?.recipeIngredient ?? [],
    instructions: sections?.recipeInstructions ?? [],
    notes: notesRange
      ? parseSectionList(
          text.slice(notesRange.bodyStart, notesRange.bodyEnd),
          false,
        )
      : [],
  };
}

/** 90 → "1h 30m". */
function readableMinutes(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""]
    .filter(Boolean)
    .join(" ");
}

/** A Cooklang front matter value as one string. */
function metaText(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value.join(", ") : (value ?? "")).trim();
}

function readCooklang(path: string, text: string): RecipeFileSummary {
  const parsed = parseCooklang(text);
  const recipe = cooklangToJsonLd(parsed, { name: basename(path) });
  const meta = parsed.metadata;
  const time =
    metaText(meta["time required"]) ||
    metaText(meta.time) ||
    metaText(meta.duration);
  // `cooklangToJsonLd` already folded prep plus cook time into one total.
  const cookTimeMins =
    cookTimeToMinutes(time || undefined) ??
    cookTimeToMinutes(
      typeof recipe.totalTime === "string" ? recipe.totalTime : undefined,
    );
  const author = recipe.author as { name?: string } | undefined;

  return {
    format: "cooklang",
    isRecipe: parsed.sections.length > 0 || parsed.ingredients.length > 0,
    title: typeof recipe.name === "string" ? recipe.name : basename(path),
    author: author?.name ?? "",
    sourceUrl: typeof recipe.url === "string" ? recipe.url : "",
    // Straight from the front matter, not the JSON-LD, which only keeps a
    // url. A path like `assets/Leek-Soup.jpg` is the plugin's image folder.
    photo:
      (metaText(meta.image) || metaText(meta.images) || metaText(meta.picture))
        .split(",")[0]
        .trim(),
    mealType: metaText(meta.course) || metaText(meta.category),
    cookTime: time || (cookTimeMins ? readableMinutes(cookTimeMins) : ""),
    cookTimeMins,
    timesMade: count(metaText(meta["times made"])),
    lastMade: metaText(meta["last made"]),
    dateAdded: metaText(meta["date added"]),
    sourceFile: metaText(meta["source file"]),
    ingredients: (recipe.recipeIngredient as string[] | undefined) ?? [],
    instructions: parsed.sections.flatMap((section) =>
      section.steps.map((step) => step.text),
    ),
    notes: parsed.notes,
  };
}

/**
 * Read a recipe out of a `.md` note or a `.cook` file. Null for any other
 * kind of file.
 *
 * The title is the note's heading or the Cooklang `title`, falling back to the
 * file name.
 */
export function readRecipeFile(
  path: string,
  text: string,
): RecipeFileSummary | null {
  const format = recipeFormatOf(path);
  if (format === "markdown") return readMarkdown(path, text);
  if (format === "cooklang") return readCooklang(path, text);
  return null;
}

/**
 * Set a recipe's cooking history in its front matter: `times_made` and
 * `last_made` in a note, `times made` and `last made` in a `.cook` file, which
 * are the names the Cooklang import and export already use. A `.cook` file with
 * no front matter gets one.
 */
export function setRecipeHistory(
  path: string,
  text: string,
  history: { timesMade: number; lastMade: string },
): string {
  if (recipeFormatOf(path) !== "cooklang") {
    return setFrontmatterValues(text, {
      times_made: history.timesMade,
      last_made: history.lastMade,
    });
  }
  return setCooklangMetadata(text, {
    "times made": history.timesMade,
    "last made": history.lastMade,
  });
}

/**
 * Set keys in a `.cook` file's front matter, adding the front matter when the
 * file has none. Keys that are already there are replaced in place.
 */
export function setCooklangMetadata(
  text: string,
  values: Record<string, string | number>,
): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (/^---[ \t]*\n[\s\S]*?\n---/.test(normalized)) {
    return setFrontmatterValues(normalized, values);
  }
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    normalized,
  ].join("\n");
}
