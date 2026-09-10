import { api, type PlanRecipe } from "./api";
import { addDays, dateKey } from "./week";

/**
 * Plan the day after `date` as leftovers of something cooked on it.
 *
 * The target day is fetched rather than read out of the week the caller is
 * already holding. Leftovers of a Sunday dinner land on Monday, which belongs
 * to the next week and isn't in that week's entries at all - reading from
 * local state would drop every meal already on that Monday.
 *
 * Returns `added: false` when the day already has these leftovers, so a second
 * tap doesn't stack a third helping of the same thing.
 */
export async function addLeftoversNextDay(
  date: string,
  recipe: PlanRecipe,
): Promise<{ date: string; added: boolean }> {
  const next = dateKey(addDays(new Date(`${date}T00:00:00`), 1));
  const { entries } = await api.plan(next, next);

  if (entries.some((e) => e.leftovers && e.recipe?.id === recipe.id)) {
    return { date: next, added: false };
  }

  // Same whole-day replace every other write uses; the API offers no append.
  await api.setPlanDay(next, [
    ...entries.map((entry) => ({
      recipeId: entry.recipe?.id ?? null,
      note: entry.note,
      leftovers: entry.leftovers,
    })),
    { recipeId: recipe.id, leftovers: true },
  ]);

  return { date: next, added: true };
}
