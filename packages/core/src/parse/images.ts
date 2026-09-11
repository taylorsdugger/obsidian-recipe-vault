import { isJsonRecord, type ParsedRecipe } from "../types";

/**
 * In order to make templating easier. Lets normalize the types of recipe images
 * to a single string url
 */
export function normalizeImages(recipe: ParsedRecipe): void {
  const image = recipe.image;
  if (typeof image === "string") {
    return;
  }

  if (Array.isArray(image)) {
    const first: unknown = image[0];
    if (typeof first === "string") {
      recipe.image = first;
      return;
    }
    if (isJsonRecord(first) && typeof first.url === "string") {
      recipe.image = first.url;
      return;
    }
  }

  /**
   * Although the spec does not show ImageObject as a top level option, it is
   * used in some big sites.
   */
  if (isJsonRecord(image) && typeof image.url === "string") {
    recipe.image = image.url;
  }
}
