import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { api, type PlanEntry, type RecipeSummary } from "../api";
import { PlanListPreview } from "../components/plan-list-preview";
import { RecipePicker } from "../components/recipe-picker";
import { navigate } from "../router";
import {
  addDays,
  dateKey,
  dayLabel,
  dayName,
  isToday,
  mondayOf,
  weekDays,
  weekLabel,
} from "../week";

/** One planned meal. A recipe opens; a free-text note just sits there. */
function EntryRow({
  entry,
  onRemove,
  busy,
}: {
  entry: PlanEntry;
  onRemove: (entry: PlanEntry) => void;
  busy: boolean;
}) {
  const recipe = entry.recipe;

  return (
    <li class="flex items-center gap-2 pr-1">
      {recipe ? (
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          {recipe.photoUrl ? (
            <img
              class="size-11 shrink-0 rounded-xl object-cover"
              src={recipe.photoUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <div class="size-11 shrink-0 rounded-xl bg-canvas" />
          )}
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-medium">
              {recipe.title}
            </span>
            {recipe.cookTime && (
              <span class="block truncate text-xs text-muted">
                {recipe.cookTime}
              </span>
            )}
          </span>
        </button>
      ) : (
        <span class="min-w-0 flex-1 py-3 text-[15px] text-muted">
          {entry.note}
        </span>
      )}

      <button
        type="button"
        aria-label="Remove"
        class="grid size-11 shrink-0 place-items-center text-lg text-faint disabled:opacity-40"
        disabled={busy}
        onClick={() => onRemove(entry)}
      >
        ×
      </button>
    </li>
  );
}

/**
 * The week plan. Monday to Sunday, one card per day, previous and next.
 *
 * The week lives in the URL as `/plan?week=YYYY-MM-DD` so a reload or a back
 * tap lands on the week you were looking at rather than snapping to this one.
 */
export function Plan() {
  const [monday, setMonday] = useState(() => weekFromUrl());
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState<Date | null>(null);
  const [shopping, setShopping] = useState(false);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => weekDays(monday), [monday]);
  const from = dateKey(monday);
  const to = dateKey(addDays(monday, 6));

  const load = useCallback(async () => {
    try {
      const res = await api.plan(from, to);
      setEntries(res.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const goto = (next: Date) => {
    setMonday(next);
    setEntries(null);
    setStatus(null);
    // replaceState, not a push: paging through weeks shouldn't fill the back
    // stack with every week you passed on the way.
    const thisWeek = dateKey(next) === dateKey(mondayOf(new Date()));
    window.history.replaceState(
      {},
      "",
      thisWeek ? "/plan" : `/plan?week=${dateKey(next)}`,
    );
  };

  /** Everything on one day, in the order the server stored it. */
  const entriesOn = (date: Date) =>
    (entries ?? []).filter((entry) => entry.date === dateKey(date));

  /**
   * Adding is a day replace: send the day as it is plus the new one. The API
   * only offers a whole-day PUT, and a day is at most a few rows.
   */
  const addTo = async (
    date: Date,
    added: { recipeId?: string; note?: string },
  ) => {
    const day = entriesOn(date);
    setBusy(true);
    setPicking(null);
    try {
      await api.setPlanDay(dateKey(date), [
        ...day.map((entry) => ({
          recipeId: entry.recipe?.id ?? null,
          note: entry.note,
        })),
        added,
      ]);
      await load();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: PlanEntry) => {
    setBusy(true);
    // Drop it now. The refetch below is the real answer, but a meal that sits
    // there for a round trip after you tapped × reads as a missed tap.
    setEntries((current) => current?.filter((e) => e.id !== entry.id) ?? null);
    try {
      await api.removePlanEntry(entry.id);
    } catch {
      // A 404 means the other phone already removed it, which is the state we
      // just drew. Either way the refetch settles it.
    } finally {
      await load();
      setBusy(false);
    }
  };

  const planned = entries?.some((entry) => entry.recipe) ?? false;

  return (
    // Clears the tab bar plus the shopping-list bar sitting above it, so the
    // last day's "Add a meal" is still tappable at the bottom of the scroll.
    <div class="pb-32">
      <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
        <button
          type="button"
          aria-label="Previous week"
          class="grid size-11 shrink-0 place-items-center rounded-xl text-muted active:bg-surface"
          onClick={() => goto(addDays(monday, -7))}
        >
          ‹
        </button>
        <div class="min-w-0 flex-1 text-center">
          <h1 class="truncate text-base font-semibold">{weekLabel(monday)}</h1>
        </div>
        <button
          type="button"
          aria-label="Next week"
          class="grid size-11 shrink-0 place-items-center rounded-xl text-muted active:bg-surface"
          onClick={() => goto(addDays(monday, 7))}
        >
          ›
        </button>
      </header>

      {/* Only worth showing when it would do something. */}
      {dateKey(monday) !== dateKey(mondayOf(new Date())) && (
        <div class="px-4 pt-3">
          <button
            type="button"
            class="text-sm text-muted underline underline-offset-4"
            onClick={() => goto(mondayOf(new Date()))}
          >
            Back to this week
          </button>
        </div>
      )}

      {error && <p class="px-4 pt-3 text-sm text-red-700">{error}</p>}
      {status && (
        <p class="mx-4 mt-3 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      <div class="space-y-3 p-4">
        {days.map((date) => {
          const day = entriesOn(date);
          const today = isToday(date);
          return (
            <section
              key={dateKey(date)}
              class={`card overflow-hidden ${today ? "border-accent" : ""}`}
            >
              <div class="flex items-baseline gap-2 px-4 pt-3">
                <h2
                  class={`text-sm font-semibold ${
                    today ? "text-accent-ink" : ""
                  }`}
                >
                  {dayName(date)}
                </h2>
                <span class="text-xs text-faint">{dayLabel(date)}</span>
                {today && (
                  <span class="ml-auto text-xs font-medium text-accent-ink">
                    Today
                  </span>
                )}
              </div>

              {day.length > 0 && (
                <ul class="divide-y divide-line px-3">
                  {day.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      onRemove={remove}
                      busy={busy}
                    />
                  ))}
                </ul>
              )}

              <button
                type="button"
                class="w-full px-4 py-3 text-left text-sm text-muted active:bg-canvas"
                onClick={() => setPicking(date)}
              >
                {day.length > 0 ? "Add another" : "Add a meal"}
              </button>
            </section>
          );
        })}
      </div>

      {/* Above the tab bar, same place the recipe screen puts its send button. */}
      {planned && (
        <div class="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur">
          <button
            type="button"
            class="btn-primary w-full"
            onClick={() => setShopping(true)}
          >
            Shopping list for this week
          </button>
        </div>
      )}

      {picking && (
        <RecipePicker
          title={`${dayName(picking)} ${dayLabel(picking)}`}
          onPick={(recipe: RecipeSummary) =>
            void addTo(picking, { recipeId: recipe.id })
          }
          onNote={(text) => void addTo(picking, { note: text })}
          onClose={() => setPicking(null)}
        />
      )}

      {shopping && (
        <PlanListPreview
          from={from}
          to={to}
          onClose={() => setShopping(false)}
          onDone={(summary) => {
            setShopping(false);
            setStatus(summary);
          }}
        />
      )}
    </div>
  );
}

/** `/plan?week=2026-09-07`, falling back to the week we're in. */
function weekFromUrl(): Date {
  const week = new URLSearchParams(window.location.search).get("week");
  if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
    const parsed = new Date(`${week}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return mondayOf(parsed);
  }
  return mondayOf(new Date());
}
