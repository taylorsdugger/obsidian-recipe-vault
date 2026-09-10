import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { api, type PlanEntry, type RecipeSummary } from "../api";
import { PlanListPreview } from "../components/plan-list-preview";
import { RecipePicker } from "../components/recipe-picker";
import { addLeftoversNextDay } from "../leftovers";
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

/**
 * One planned meal. A recipe opens; a free-text note just sits there.
 *
 * Kept to a single 44px line so a seven-day week fits on a phone screen. The
 * title wraps to two lines rather than truncating - "Roasted Beet Hummus
 * Recipe" cut to "Roasted Beet Hummus Rec..." tells you less than the second
 * line costs.
 */
function EntryRow({
  entry,
  onRemove,
  onLeftovers,
  busy,
}: {
  entry: PlanEntry;
  onRemove: (entry: PlanEntry) => void;
  onLeftovers: (entry: PlanEntry) => void;
  busy: boolean;
}) {
  const recipe = entry.recipe;

  return (
    <li class="flex items-center gap-1">
      {recipe ? (
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          {recipe.photoUrl ? (
            <img
              class="size-10 shrink-0 rounded-lg object-cover"
              src={recipe.photoUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <div class="size-10 shrink-0 rounded-lg bg-canvas" />
          )}
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 text-[15px] leading-snug font-medium">
              {entry.leftovers && <span class="text-faint">Leftovers · </span>}
              {recipe.title}
            </span>
            {/* Cook time is about cooking it, so a reheat doesn't show one. */}
            {recipe.cookTime && !entry.leftovers && (
              <span class="mt-0.5 block text-xs text-faint">
                {recipe.cookTime}
              </span>
            )}
          </span>
        </button>
      ) : (
        <span class="min-w-0 flex-1 py-2 text-[15px] leading-snug text-muted">
          {entry.note}
        </span>
      )}

      {/* Carry it into tomorrow. Same weight as the remove x - both are quiet
          row affordances, and this is the one you reach for more often. */}
      {recipe && !entry.leftovers && (
        <button
          type="button"
          aria-label="Leftovers tomorrow"
          title="Leftovers tomorrow"
          class="grid size-8 shrink-0 place-items-center rounded-lg text-faint active:bg-canvas disabled:opacity-40"
          disabled={busy}
          onClick={() => onLeftovers(entry)}
        >
          {/* An arrow into the next day. */}
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
            <path
              d="M2.5 8 H11 M7.5 4.5 L11 8 L7.5 11.5 M13.5 3.5 V12.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </button>
      )}

      {/* Quiet on purpose: removing is the rarest thing you do here, and a
          heavy glyph next to every meal made the week look like a to-do list. */}
      <button
        type="button"
        aria-label="Remove"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-faint active:bg-canvas disabled:opacity-40"
        disabled={busy}
        onClick={() => onRemove(entry)}
      >
        <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true">
          <path
            d="M3 3 L13 13 M13 3 L3 13"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
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
  const thisWeek = dateKey(monday) === dateKey(mondayOf(new Date()));
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
        // Carry `leftovers` through. The day is rewritten whole, so anything
        // left off here is silently cleared on the way past.
        ...day.map((entry) => ({
          recipeId: entry.recipe?.id ?? null,
          note: entry.note,
          leftovers: entry.leftovers,
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

  const leftovers = async (entry: PlanEntry) => {
    if (!entry.recipe) return;
    setBusy(true);
    try {
      const res = await addLeftoversNextDay(entry.date, entry.recipe);
      setStatus(
        res.added
          ? `Leftovers added to ${dayLabel(new Date(`${res.date}T00:00:00`))}.`
          : `That day already has those leftovers.`,
      );
      // Tomorrow may be next week - Sunday's leftovers land on Monday - in
      // which case this refetch won't show it and the status line is all you get.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Leftovers don't buy anything, so a week holding only reheats would open a
  // preview with nothing in it.
  const planned =
    entries?.some((entry) => entry.recipe && !entry.leftovers) ?? false;

  return (
    // Clears the tab bar plus the shopping-list bar sitting above it, so the
    // last day's "Add" is still tappable at the bottom of the scroll.
    <div class="pb-24">
      <header class="sticky top-0 z-10 border-b border-line bg-canvas/95 backdrop-blur">
        <div class="mx-auto flex max-w-2xl items-center gap-1 px-1.5 py-1.5">
          <button
            type="button"
            aria-label="Previous week"
            class="grid size-9 shrink-0 place-items-center rounded-lg text-muted active:bg-surface"
            onClick={() => goto(addDays(monday, -7))}
          >
            ‹
          </button>
          <div class="min-w-0 flex-1 text-center">
            <h1 class="truncate text-[15px] font-semibold">
              {weekLabel(monday)}
            </h1>
          </div>
          {/* Sits where a second nav button would, so the header keeps its
            symmetry whether or not the jump-back is showing. */}
          {thisWeek ? (
            <div class="size-9 shrink-0" />
          ) : (
            <button
              type="button"
              class="grid h-9 shrink-0 place-items-center rounded-lg px-2 text-xs font-medium text-accent-ink active:bg-surface"
              onClick={() => goto(mondayOf(new Date()))}
            >
              Today
            </button>
          )}
          <button
            type="button"
            aria-label="Next week"
            class="grid size-9 shrink-0 place-items-center rounded-lg text-muted active:bg-surface"
            onClick={() => goto(addDays(monday, 7))}
          >
            ›
          </button>
        </div>
      </header>

      {error && <p class="px-4 pt-3 text-sm text-red-700">{error}</p>}
      {status && (
        <p class="mx-3 mt-3 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      {/* One list, not seven cards. A week has to read as a week, and seven
          separate cards cost 865px of scroll for 812px of screen. */}
      {/* Capped and centred. Left full width, a 1100px row strands the remove
          button half a screen from the meal it belongs to. */}
      <div class="mx-auto max-w-2xl p-3">
        <ul class="card divide-y divide-line overflow-hidden">
          {days.map((date) => {
            const day = entriesOn(date);
            const today = isToday(date);
            return (
              <li
                key={dateKey(date)}
                class={`flex gap-3 px-3 py-1.5 ${today ? "bg-accent/6" : ""}`}
              >
                {/* Fixed-width date gutter, so every day lines up down the
                    left however many meals it holds. */}
                <div class="w-9 shrink-0 pt-1.5 text-center">
                  <div class="text-[10px] leading-none font-medium tracking-wide text-faint uppercase">
                    {dayName(date)}
                  </div>
                  <div
                    class={`mx-auto mt-1 grid size-6 place-items-center text-sm leading-none font-semibold ${
                      today ? "rounded-full bg-accent text-white" : "text-ink"
                    }`}
                  >
                    {date.getDate()}
                  </div>
                </div>

                <div class="min-w-0 flex-1">
                  {day.length > 0 && (
                    <ul class="divide-y divide-line/70">
                      {day.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          onRemove={remove}
                          onLeftovers={leftovers}
                          busy={busy}
                        />
                      ))}
                    </ul>
                  )}

                  {/* An inline affordance rather than a full-width row. Seven
                      of those were 308px, a third of the whole scroll. */}
                  <button
                    type="button"
                    class="flex h-7 items-center gap-1 text-[13px] text-faint active:text-muted"
                    onClick={() => setPicking(date)}
                  >
                    <span class="text-sm leading-none">+</span>
                    <span>{day.length > 0 ? "Add" : "Add a meal"}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Above the tab bar, same place the recipe screen puts its send button. */}
      {planned && (
        <div class="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur">
          <div class="mx-auto max-w-2xl">
            <button
              type="button"
              class="btn-primary w-full"
              onClick={() => setShopping(true)}
            >
              Shopping list for this week
            </button>
          </div>
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
