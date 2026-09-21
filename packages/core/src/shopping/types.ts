/** One line on the shopping list, parsed into parts the merge can add up. */
export interface ShoppingItem {
  checked: boolean;
  /** Numeric quantity; 0 when the line had none ("salt to taste"). */
  amount: number;
  /** Canonical unit from `normalizeIngredientUnit`, or "" when unitless. */
  unit: string;
  /**
   * The normalized ingredient name from `normalizeShoppingName`: lowercase,
   * singular, with prep and size words lifted off. The merge key, which is
   * why it is this aggressive - "large onion" and "yellow onions" have to
   * arrive here as the same string to add up.
   */
  name: string;
  /**
   * The words lifted off the name to get there: "large", "yellow", "organic".
   * Rendered under the row rather than dropped, so merging three onions into
   * one line doesn't hide that one of them was meant to be red.
   */
  qualifiers: string[];
  /**
   * What the recipe said to do with it - "diced", "at room temperature".
   * Carried through so a round trip doesn't quietly rewrite "1 onion, diced"
   * as "1 onion".
   */
  note: string;
  /** Whether the line wrote the name plural, for rendering it back that way. */
  plural: boolean;
  /**
   * The line had no ingredient in it - "(optional)", "chopped", a stray "s".
   * `name` is then the line as written, so nothing is invented and nothing is
   * silently lost. Recipe ingestion drops these; a line already in the note
   * keeps its place.
   */
  fragment: boolean;
  /** Recipe titles this item came from, rendered as `*(A, B)*`. */
  sources: string[];
  /** The raw text as it appeared, used for display when there's no amount. */
  original: string;
}

/** The fields `parseShoppingLine` fills in. */
export type ParsedShoppingLine = Omit<ShoppingItem, "checked" | "original">;
