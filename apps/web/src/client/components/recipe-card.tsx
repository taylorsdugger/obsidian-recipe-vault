import type { RecipeSummary } from "../api";
import { madeSummary, spaced } from "../format";
import { RecipePhoto } from "./recipe-photo";

/**
 * The gallery card, ported from the plugin's `RecipeCard`. Photo on top,
 * title, then the same meta line the note's "At a Glance" callout shows.
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
  const meta = [spaced(recipe.mealType), recipe.cookTime]
    .filter(Boolean)
    .join(" · ");
  const made = madeSummary(recipe.timesMade, recipe.lastMade);

  return (
    <button
      type="button"
      class="card flex flex-col overflow-hidden text-left transition-colors active:bg-canvas"
      onClick={() => onOpen(recipe.id)}
    >
      <RecipePhoto
        src={recipe.photoUrl}
        box="aspect-[4/3] w-full"
        mark="size-12"
      />
      <div class="flex-1 space-y-1 p-3">
        <h2 class="line-clamp-2 text-sm leading-snug font-medium">
          {recipe.title}
        </h2>
        {/* Both meta lines are single-line and truncated, so a row of cards
            keeps the same height whatever the recipe is called. */}
        {meta && <p class="truncate text-xs text-muted">{meta}</p>}
        {made && <p class="truncate text-xs text-faint">{made}</p>}
      </div>
    </button>
  );
}
