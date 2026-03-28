export interface RecipeNote {
  /** Display name — the note's file basename */
  title: string;
  /** Vault-relative path used to open the note */
  path: string;
  /** Resolved URL or resource path for the recipe photo */
  photo: string;
  /** Meal types split and trimmed from the frontmatter comma-separated string */
  meal_type: string[];
  /** Human-readable cook time string from frontmatter (e.g. "1 hour 30 minutes") */
  cook_time: string;
  /** Cook time parsed to total minutes; 0 if not available */
  cook_time_mins: number;
  /** Number of times the recipe has been made (frontmatter.times_made) */
  times_made: number;
  /** Ingredient list from frontmatter.recipeIngredient */
  ingredients: string[];
  /** Whether the recipe is archived (from frontmatter.archived) */
  archived: boolean;
}
