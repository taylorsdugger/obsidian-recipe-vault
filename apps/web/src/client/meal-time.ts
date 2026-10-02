import { SLOTS, slotOf, type PlanEntry, type Slot } from "./api";
import { addDays, dateKey, startOfDay } from "./week";

/**
 * Which meal the home screen is about right now.
 *
 * The edges lean late on purpose. Brunch at half ten is still breakfast, a
 * late lunch at two is still lunch, and dinner holds until half nine so a late
 * night in the kitchen can still mark it made. After that the day is done and
 * the next thing to cook is tomorrow's breakfast.
 *
 * Minutes since midnight, local time.
 */
const LUNCH_FROM = 10 * 60 + 30;
const DINNER_FROM = 15 * 60;
const TOMORROW_FROM = 21 * 60 + 30;

export interface MealTime {
  /** Midnight of the day the meal is on. Tomorrow, late in the evening. */
  day: Date;
  slot: Slot;
}

export function mealTime(now: Date): MealTime {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = startOfDay(now);

  if (minutes >= TOMORROW_FROM) {
    return { day: addDays(today, 1), slot: "breakfast" };
  }
  if (minutes >= DINNER_FROM) return { day: today, slot: "dinner" };
  if (minutes >= LUNCH_FROM) return { day: today, slot: "lunch" };
  return { day: today, slot: "breakfast" };
}

/**
 * The next planned meal on `day`, starting from `slot`.
 *
 * Plenty of days only plan dinner, so an empty breakfast falls through to
 * whatever's next rather than leaving the screen blank all morning. It stops
 * at the end of the day: at 8am a meal on tomorrow's plan isn't what you're
 * making next, and "nothing planned" with a button is more use.
 *
 * Within a slot a recipe wins over a free-text note, whatever order they were
 * added in. The photo and "mark made" are the point of the card.
 */
export function nextMeal(
  entries: PlanEntry[],
  day: string,
  slot: Slot,
): PlanEntry | null {
  for (const s of SLOTS.slice(SLOTS.indexOf(slot))) {
    const inSlot = entries.filter(
      (entry) => entry.date === day && slotOf(entry) === s,
    );
    const pick = inSlot.find((entry) => entry.recipe) ?? inSlot[0];
    if (pick) return pick;
  }
  return null;
}

/** Same day and slot means the screen doesn't need to change. */
export function sameMealTime(a: MealTime, b: MealTime): boolean {
  return dateKey(a.day) === dateKey(b.day) && a.slot === b.slot;
}

/**
 * What's planned after the meal home is built around, in the order it'll be
 * eaten: anything else in the same slot, the rest of that day, then the days
 * after. The "Next up" strip under the hero.
 *
 * Meals earlier the same day are left out. At dinner time, breakfast has
 * been eaten and isn't next for anything.
 */
export function mealsAfter(
  entries: PlanEntry[],
  hero: PlanEntry | null,
  day: string,
  slot: Slot,
  limit: number,
): PlanEntry[] {
  const from = SLOTS.indexOf(slot);
  const order = (entry: PlanEntry) => SLOTS.indexOf(slotOf(entry));
  return (
    entries
      .filter(
        (entry) =>
          entry !== hero &&
          (entry.date > day || (entry.date === day && order(entry) >= from)),
      )
      // `sort` is stable, so the plan's own order holds within a slot.
      .sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b))
      .slice(0, limit)
  );
}
