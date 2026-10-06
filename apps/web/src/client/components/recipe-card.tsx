import type { RecipeSummary } from "../api";
import { RecipePhoto } from "./recipe-photo";

/**
 * The gallery card, ported from the plugin's `RecipeCard`. Photo on top, the
 * title in the display face, then how long it takes and how often it's been
 * made - the two things that decide a weeknight.
 *
 * No border or surface. The photo is the card, and on a grid of them a box
 * round each one was more lines than food.
 *
 * A column so the text block can grow: the grid stretches every card in a row
 * to the tallest, and without this the spare height opened up as a gap between
 * the photo and the title rather than falling below the text.
 */
export function RecipeCard({
  recipe,
  onOpen,
}: {
  recipe: RecipeSummary;
  onOpen: (id: string) => void;
}) {
  const meta = [
    recipe.cookTime,
    recipe.timesMade > 0 ? `${recipe.timesMade}×` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      class="flex flex-col gap-2 text-left active:opacity-80"
      onClick={() => onOpen(recipe.id)}
    >
      <RecipePhoto
        src={recipe.photoUrl}
        box="h-44 w-full rounded-[20px] lg:h-49"
        mark="size-12"
      />
      <div class="flex-1 space-y-0.5 px-0.5">
        <h2 class="line-clamp-2 font-display text-lg leading-[1.2] font-medium lg:text-[1.1875rem]">
          {recipe.title}
        </h2>
        {/* Single-line and truncated, so a row of cards keeps the same height
            whatever the recipe is called. */}
        {meta && <p class="truncate text-note text-muted">{meta}</p>}
      </div>
    </button>
  );
}
