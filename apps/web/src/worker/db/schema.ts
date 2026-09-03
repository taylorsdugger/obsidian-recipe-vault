import {
  integer,
  real,
  sqliteTable,
  text,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * The rendered note is the source of truth (locked decision 2). Everything
 * else on this table is derived from `markdown` on every write, so the later
 * vault sync is a file copy rather than a migration.
 */
export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    author: text("author"),
    sourceUrl: text("source_url"),
    photoUrl: text("photo_url"),
    /** Comma string, same shape as the note's frontmatter. */
    mealType: text("meal_type"),
    cookTime: text("cook_time"),
    cookTimeMins: integer("cook_time_mins"),
    /** JSON string[], derived from the body's `### Ingredients` section. */
    ingredients: text("ingredients").notNull().default("[]"),
    timesMade: integer("times_made").notNull().default(0),
    lastMade: text("last_made"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("recipes_title_idx").on(table.title)],
);

/** One meal on one day. Either a recipe or free text ("leftovers"), not both. */
export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: text("id").primaryKey(),
    /** YYYY-MM-DD. */
    date: text("date").notNull(),
    slot: text("slot").notNull().default("dinner"),
    recipeId: text("recipe_id").references(() => recipes.id, {
      onDelete: "cascade",
    }),
    note: text("note"),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("plan_entries_date_idx").on(table.date)],
);

/**
 * Rows map one to one onto core's `ShoppingItem`, so adding to the list is
 * load rows, `mergeShoppingItems`, upsert. No new math on this side.
 */
export const shoppingItems = sqliteTable("shopping_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  amount: real("amount").notNull().default(0),
  unit: text("unit").notNull().default(""),
  checked: integer("checked").notNull().default(0),
  /** JSON string[] of recipe names, rendered as the *(Source)* annotation. */
  sources: text("sources").notNull().default("[]"),
  original: text("original"),
  position: integer("position").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export type RecipeRow = typeof recipes.$inferSelect;
export type PlanEntryRow = typeof planEntries.$inferSelect;
export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
