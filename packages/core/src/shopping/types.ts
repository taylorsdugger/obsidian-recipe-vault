/** One line on the shopping list, parsed into parts the merge can add up. */
export interface ShoppingItem {
  checked: boolean;
  /** Numeric quantity; 0 when the line had none ("salt to taste"). */
  amount: number;
  /** Canonical unit from `normalizeIngredientUnit`, or "" when unitless. */
  unit: string;
  /** Lowercased ingredient name with prep notes stripped. Merge key. */
  name: string;
  /** Recipe titles this item came from, rendered as `*(A, B)*`. */
  sources: string[];
  /** The raw text as it appeared, used for display when there's no amount. */
  original: string;
}
