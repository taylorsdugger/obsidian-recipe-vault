import type { JsonRecord } from "../types";
import { cookTimeToMinutes, readFrontmatter } from "./frontmatter";
import { findMarkdownSection, parseSectionList } from "./sections";

/**
 * Vault-only state that rides along with an exported recipe.
 *
 * schema.org has nowhere to put "I've made this four times", but it's the
 * user's own data and a note that round-trips through export and import
 * shouldn't come back with its history reset. Kept under its own key so it
 * reads as this plugin's, not as a schema.org field another app should trust.
 */
export interface RecipeVaultState {
  timesMade?: number;
  lastMade?: string;
}

/** Where {@link RecipeVaultState} lives on an exported recipe. */
export const VAULT_STATE_KEY = "recipeVault";

/** Read vault state back off an imported recipe, ignoring anything malformed. */
export function readRecipeVaultState(recipe: JsonRecord): RecipeVaultState {
  const raw = recipe[VAULT_STATE_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const state = raw as Record<string, unknown>;

  const out: RecipeVaultState = {};
  if (typeof state.timesMade === "number" && Number.isFinite(state.timesMade)) {
    out.timesMade = Math.max(0, Math.round(state.timesMade));
  }
  if (typeof state.lastMade === "string" && state.lastMade.trim()) {
    out.lastMade = state.lastMade.trim();
  }
  return out;
}

export interface NoteToJsonLdOptions {
  /**
   * The recipe's name. The note's `# Heading` is used when this is omitted,
   * but callers with a `TFile` should pass the basename: it's what the gallery
   * treats as the title, and a hand-edited note may have no heading at all.
   */
  name?: string;
}

/** Whole minutes back to an ISO 8601 duration: 90 → "PT1H30M". */
function minutesToIsoDuration(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours === 0) return `PT${minutes}M`;
  if (minutes === 0) return `PT${hours}H`;
  return `PT${hours}H${minutes}M`;
}

/** The name out of `# [Roast Chicken](https://…)` or plain `# Roast Chicken`. */
function nameFromHeading(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (!heading) return "";
  const text = heading[1].trim();
  const link = text.match(/^\[(.+?)\]\(.*\)$/);
  return (link ? link[1] : text).trim();
}

/** Read one section's list items, or an empty array when it isn't there. */
function sectionItems(
  markdown: string,
  heading: string,
  isIngredients: boolean,
): string[] {
  const range = findMarkdownSection(markdown, heading);
  if (!range) return [];
  return parseSectionList(
    markdown.slice(range.bodyStart, range.bodyEnd),
    isIngredients,
  );
}

/**
 * Build a schema.org Recipe from a recipe note, so it can be shared with
 * anything that reads JSON-LD.
 *
 * The note is the source of truth here, not a stored copy of the original
 * import: whatever the user has edited since is what comes out.
 *
 * Vault-local image paths are dropped, because a `[[Recipe Images/pie.jpg]]`
 * wikilink means nothing outside this vault — only an http(s) photo survives.
 *
 * Cooking history goes out under `recipeVault` rather than being lost. It
 * isn't schema.org and another app will skip it, but exporting a note and
 * importing it back shouldn't reset your own counts.
 *
 * Empty fields are left out entirely rather than written as `""`, so a sparse
 * note produces a small object instead of a mostly-blank one.
 */
export function noteToJsonLd(
  markdown: string,
  opts: NoteToJsonLdOptions = {},
): JsonRecord {
  const fm = readFrontmatter(markdown);

  const recipe: JsonRecord = {
    "@context": "https://schema.org",
    "@type": "Recipe",
  };

  const name = (opts.name ?? nameFromHeading(markdown)).trim();
  if (name) recipe.name = name;

  if (fm.author) recipe.author = { "@type": "Person", name: fm.author };
  if (fm.url) recipe.url = fm.url;
  if (fm.created) recipe.datePublished = fm.created;

  // The template writes `photo` as a wikilink for vault files and a bare URL
  // for remote ones. Only the remote form is portable.
  if (fm.photo && /^https?:\/\//i.test(fm.photo)) {
    recipe.image = fm.photo;
  }

  // `meal_type` is a comma-separated string in frontmatter; schema.org takes
  // either a string or a list, and a list round-trips more cleanly.
  const categories = (fm.meal_type ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (categories.length === 1) recipe.recipeCategory = categories[0];
  else if (categories.length > 1) recipe.recipeCategory = categories;

  // Cook time goes back out as the ISO duration schema.org expects, even
  // though the note stores the readable "1h 30m" form.
  const mins = cookTimeToMinutes(fm.cook_time);
  if (mins !== null && mins > 0) recipe.totalTime = minutesToIsoDuration(mins);

  const ingredients = sectionItems(markdown, "Ingredients", true);
  if (ingredients.length > 0) recipe.recipeIngredient = ingredients;

  const instructions = sectionItems(markdown, "Instructions", false);
  if (instructions.length > 0) {
    recipe.recipeInstructions = instructions.map((text) => ({
      "@type": "HowToStep",
      text,
    }));
  }

  // Not a schema.org field, but it's the one the importer already reads and
  // dropping it would lose the notes on a round trip.
  const notes = sectionItems(markdown, "Notes", false);
  if (notes.length > 0) recipe.recipeNotes = notes;

  const vaultState: RecipeVaultState = {};
  const timesMade = Number(fm.times_made);
  if (Number.isFinite(timesMade) && timesMade > 0) {
    vaultState.timesMade = Math.round(timesMade);
  }
  if (fm.last_made) vaultState.lastMade = fm.last_made;
  if (Object.keys(vaultState).length > 0) {
    recipe[VAULT_STATE_KEY] = vaultState;
  }

  return recipe;
}
