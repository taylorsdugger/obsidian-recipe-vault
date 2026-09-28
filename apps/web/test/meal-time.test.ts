import { describe, expect, it } from "vitest";

import type { PlanEntry } from "../src/client/api";
import { mealTime, nextMeal } from "../src/client/meal-time";
import { dateKey } from "../src/client/week";

function at(hours: number, minutes = 0) {
  const { day, slot } = mealTime(new Date(2026, 8, 28, hours, minutes));
  return { day: dateKey(day), slot };
}

let id = 0;
function entry(
  slot: string,
  opts: { date?: string; title?: string; note?: string } = {},
): PlanEntry {
  id += 1;
  return {
    id: `e${id}`,
    date: opts.date ?? "2026-09-28",
    slot,
    note: opts.note ?? null,
    position: 0,
    leftovers: false,
    recipe: opts.title
      ? {
          id: `r${id}`,
          title: opts.title,
          photoUrl: null,
          cookTime: null,
          lastMade: null,
        }
      : null,
  } as PlanEntry;
}

describe("mealTime", () => {
  it("picks the slot by the clock", () => {
    expect(at(0, 30)).toEqual({ day: "2026-09-28", slot: "breakfast" });
    expect(at(8)).toEqual({ day: "2026-09-28", slot: "breakfast" });
    expect(at(10, 29)).toEqual({ day: "2026-09-28", slot: "breakfast" });
    expect(at(10, 30)).toEqual({ day: "2026-09-28", slot: "lunch" });
    expect(at(14, 59)).toEqual({ day: "2026-09-28", slot: "lunch" });
    expect(at(15)).toEqual({ day: "2026-09-28", slot: "dinner" });
    expect(at(21, 29)).toEqual({ day: "2026-09-28", slot: "dinner" });
  });

  it("moves to tomorrow's breakfast once dinner's done", () => {
    expect(at(21, 30)).toEqual({ day: "2026-09-29", slot: "breakfast" });
    expect(at(23, 59)).toEqual({ day: "2026-09-29", slot: "breakfast" });
  });
});

describe("nextMeal", () => {
  const day = "2026-09-28";

  it("returns the meal in the current slot", () => {
    const lunch = entry("lunch", { title: "Soup" });
    const dinner = entry("dinner", { title: "Tacos" });
    expect(nextMeal([dinner, lunch], day, "lunch")).toBe(lunch);
  });

  it("falls through an empty slot to the next one", () => {
    const dinner = entry("dinner", { title: "Tacos" });
    expect(nextMeal([dinner], day, "breakfast")).toBe(dinner);
  });

  it("never goes back to an earlier slot", () => {
    const breakfast = entry("breakfast", { title: "Eggs" });
    expect(nextMeal([breakfast], day, "lunch")).toBeNull();
  });

  it("stays on its own day", () => {
    const tomorrow = entry("breakfast", { date: "2026-09-29", title: "Eggs" });
    expect(nextMeal([tomorrow], day, "dinner")).toBeNull();
  });

  it("prefers a recipe over a note in the same slot", () => {
    const note = entry("dinner", { note: "Out" });
    const recipe = entry("dinner", { title: "Tacos" });
    expect(nextMeal([note, recipe], day, "dinner")).toBe(recipe);
  });

  it("reads an old slotless row as dinner", () => {
    const old = entry("", { title: "Tacos" });
    expect(nextMeal([old], day, "lunch")).toBe(old);
  });
});
