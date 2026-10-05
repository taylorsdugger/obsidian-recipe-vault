/**
 * How a recipe looks on a phone, the same choice the plugin's "Mobile recipe
 * layout" setting makes. Kitchen splits it into Ingredients and Steps behind
 * a switch in the dock. Classic is the one scrolling page.
 *
 * Per device, like the theme. It's about how one screen reads, and the two
 * phones in the house can disagree. From `lg` up neither applies: the desktop
 * layout already has the ingredients in a column beside the steps.
 */
export type RecipeLayout = "kitchen" | "classic";

const KEY = "recipe-vault:recipe-layout";

/** Kitchen unless this device chose Classic, since Kitchen came first. */
export function storedRecipeLayout(): RecipeLayout {
  try {
    return window.localStorage.getItem(KEY) === "classic"
      ? "classic"
      : "kitchen";
  } catch {
    return "kitchen";
  }
}

export function setRecipeLayout(layout: RecipeLayout): void {
  try {
    if (layout === "kitchen") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, layout);
  } catch {
    // Storage blocked. The next recipe opens in Kitchen, which is fine.
  }
}
