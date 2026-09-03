import type { RecipeSummary } from "../api";

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
  // Meal type is a comma string copied straight out of the frontmatter, so it
  // arrives as "Main Course,Soup". Space it out for reading.
  const mealType = recipe.mealType
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const meta = [mealType, recipe.cookTime].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      class="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left"
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
        <div class="aspect-[4/3] w-full bg-neutral-100" />
      )}
      <div class="space-y-1 p-3">
        <h2 class="line-clamp-2 font-medium leading-snug">{recipe.title}</h2>
        {meta && <p class="text-xs text-neutral-500">{meta}</p>}
        {recipe.timesMade > 0 && (
          <p class="text-xs text-neutral-400">
            Made {recipe.timesMade}
            {recipe.timesMade === 1 ? " time" : " times"}
            {recipe.lastMade ? `, last on ${recipe.lastMade}` : ""}
          </p>
        )}
      </div>
    </button>
  );
}
