import type { RecipeSummary } from "../api";
import { madeSummary, spaced } from "../format";

/**
 * The gallery card, ported from the plugin's `RecipeCard`. Photo on top,
 * title, then the same meta line the note's "At a Glance" callout shows.
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
      class="card overflow-hidden text-left"
      onClick={() => onOpen(recipe.id)}
    >
      {recipe.photoUrl ? (
        <img
          class="aspect-[4/3] w-full object-cover"
          src={recipe.photoUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div class="aspect-[4/3] w-full bg-canvas" />
      )}
      <div class="space-y-1 p-3">
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
