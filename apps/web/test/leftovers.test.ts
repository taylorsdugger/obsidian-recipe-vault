import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanEntry } from "../src/client/api";

const plan = vi.fn();
const setPlanDay = vi.fn();

// Only the two requests are stubbed; `slotOf` and the rest are the real thing.
vi.mock("../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/api")>()),
  api: {
    plan: (...args: unknown[]) => plan(...args),
    setPlanDay: (...args: unknown[]) => setPlanDay(...args),
  },
}));

const { addLeftoversNextDay } = await import("../src/client/leftovers");

const RECIPE = {
  id: "r1",
  title: "Curry",
  photoUrl: null,
  cookTime: "45m",
  lastMade: null,
};

/** A day's worth of entries, as `GET /api/plan` would answer. */
function entry(over: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: "e1",
    date: "2026-09-11",
    slot: "dinner",
    note: null,
    position: 0,
    leftovers: false,
    recipe: null,
    ...over,
  };
}

beforeEach(() => {
  plan.mockReset();
  setPlanDay.mockReset();
  plan.mockResolvedValue({ entries: [] });
  setPlanDay.mockResolvedValue({ entries: [] });
});

/**
 * The two things here that break quietly: the next day is date arithmetic, not
 * a `+1` on a string, and the write is a whole-day replace - so whatever is
 * already on that day has to be sent back or it's gone.
 */
describe("addLeftoversNextDay", () => {
  it("lands on the next day across week, month and year ends", async () => {
    // Sunday. Its Monday belongs to the next week, which is the case the
    // caller's own loaded week can't answer.
    await addLeftoversNextDay("2026-09-13", RECIPE);
    expect(plan).toHaveBeenCalledWith("2026-09-14", "2026-09-14");

    await addLeftoversNextDay("2026-09-30", RECIPE);
    expect(plan).toHaveBeenLastCalledWith("2026-10-01", "2026-10-01");

    await addLeftoversNextDay("2026-12-31", RECIPE);
    expect(plan).toHaveBeenLastCalledWith("2027-01-01", "2027-01-01");
  });

  it("keeps what's already on the target day, flags and all", async () => {
    plan.mockResolvedValue({
      entries: [
        entry({ id: "a", recipe: { ...RECIPE, id: "other", title: "Cake" } }),
        entry({ id: "b", note: "Out" }),
        entry({
          id: "c",
          leftovers: true,
          recipe: { ...RECIPE, id: "soup", title: "Soup" },
        }),
      ],
    });

    await addLeftoversNextDay("2026-09-10", RECIPE);

    // The existing three come back untouched, with the new one appended.
    // Dropping `leftovers` on the way past would un-flag someone's reheat and
    // put its ingredients back on the shop; dropping `slot` would move every
    // breakfast on the day to dinner.
    expect(setPlanDay).toHaveBeenCalledWith("2026-09-11", [
      { recipeId: "other", note: null, slot: "dinner", leftovers: false },
      { recipeId: null, note: "Out", slot: "dinner", leftovers: false },
      { recipeId: "soup", note: null, slot: "dinner", leftovers: true },
      { recipeId: "r1", slot: "dinner", leftovers: true },
    ]);
  });

  it("keeps each meal in its own slot and puts the reheat in the cook's", async () => {
    plan.mockResolvedValue({
      entries: [
        entry({ id: "a", slot: "breakfast", note: "Eggs" }),
        // A row from before the plan had slots, or a value it doesn't know.
        entry({ id: "b", slot: "brunch", note: "Out" }),
      ],
    });

    await addLeftoversNextDay("2026-09-10", RECIPE, "lunch");

    expect(setPlanDay).toHaveBeenCalledWith("2026-09-11", [
      { recipeId: null, note: "Eggs", slot: "breakfast", leftovers: false },
      { recipeId: null, note: "Out", slot: "dinner", leftovers: false },
      { recipeId: "r1", slot: "lunch", leftovers: true },
    ]);
  });

  it("won't stack a second helping of the same leftovers", async () => {
    plan.mockResolvedValue({
      entries: [entry({ leftovers: true, recipe: RECIPE })],
    });

    const res = await addLeftoversNextDay("2026-09-10", RECIPE);

    expect(res).toEqual({ date: "2026-09-11", added: false });
    expect(setPlanDay).not.toHaveBeenCalled();
  });

  it("still adds when the same recipe is cooked that day rather than reheated", async () => {
    // Curry Thursday and curry again Friday is a real plan - two cooks, two
    // shops. Only an existing *leftovers* row should block this.
    plan.mockResolvedValue({
      entries: [entry({ leftovers: false, recipe: RECIPE })],
    });

    const res = await addLeftoversNextDay("2026-09-10", RECIPE);

    expect(res.added).toBe(true);
    expect(setPlanDay).toHaveBeenCalled();
  });
});
