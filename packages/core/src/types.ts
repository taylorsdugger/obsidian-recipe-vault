/** A plain object node from parsed JSON-LD (values are still untyped JSON). */
export type JsonRecord = Record<string, unknown>;

/** Narrow an unknown JSON value to a plain object (not null, not an array). */
export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One normalized instruction line: a step or an item within a HowToSection. */
export interface InstructionItem {
  text: string;
  image?: unknown;
}

/** A normalized recipe instruction — either a plain step or a HowToSection. */
export interface InstructionStep {
  name?: string;
  text?: string;
  image?: unknown;
  itemListElement?: InstructionItem[];
}

/**
 * A recipe parsed from a page's JSON-LD and normalized for templating. JSON-LD
 * is free-form, so unknown-typed index access is intentional; the fields the
 * importer reads or writes are declared explicitly so they stay type-safe.
 */
export interface ParsedRecipe {
  [key: string]: unknown;
  name?: unknown;
  image?: unknown;
  author?: unknown;
  url?: string;
  totalTime?: unknown;
  recipeIngredient?: string[];
  recipeInstructions?: InstructionStep[];
  recipeNotes?: string[];
}
