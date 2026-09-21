import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import {
  api,
  slotOf,
  type ListItem,
  type PlanEntry,
  type PlanRecipe,
  type RecipeSummary,
} from "../api";
import { RecipePhoto } from "../components/recipe-photo";
import { madeToday } from "../format";
import { RecipePicker } from "../components/recipe-picker";
import { addLeftoversNextDay } from "../leftovers";
import { navigate } from "../router";
import { SYNCED_EVENT } from "../sync";
import {
  addDays,
  dateKey,
  dayName,
  mondayOf,
  startOfDay,
  weekDays,
} from "../week";

/**
 * Today, re-read whenever the app comes back to the front.
 *
 * Every word on this screen is about what day it is, and an installed PWA left
 * on the kitchen counter overnight is still the same mount in the morning. The
 * identity check keeps the same `Date` object when the day hasn't turned, so
 * the fetch below doesn't re-run on every tab switch.
 */
function useToday(): Date {
  const [today, setToday] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = startOfDay(new Date());
      setToday((current) =>
        dateKey(current) === dateKey(now) ? current : now,
      );
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  return today;
}

/** "Thursday, Sep 10", in whatever order the phone's locale puts the two. */
function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/**
 * The one meal the screen is built around. The photo and title open the
 * recipe; "Mark made" is the only other thing you do standing in the kitchen.
 */
function Tonight({
  entry,
  busy,
  onMade,
  onLeftovers,
}: {
  entry: PlanEntry;
  busy: boolean;
  onMade: (recipe: PlanRecipe) => void;
  onLeftovers: (recipe: PlanRecipe) => void;
}) {
  const recipe = entry.recipe;
  const alreadyMade = madeToday(recipe?.lastMade ?? null);

  // A free-text night - leftovers, out, someone else is cooking. Nothing to
  // open and nothing to mark, so it's just the words.
  if (!recipe) {
    return (
      <div class="card p-4">
        <p class="text-lg leading-snug font-medium text-muted">{entry.note}</p>
      </div>
    );
  }

  return (
    <div class="card overflow-hidden">
      <button
        type="button"
        class="block w-full text-left"
        onClick={() => navigate(`/recipes/${recipe.id}`)}
      >
        {/* Same fixed-height hero the recipe screen uses, for the same reason:
            these photos come from other people's sites and a tall one would
            push the button that matters off the bottom of the screen. */}
        {recipe.photoUrl ? (
          <img class="h-44 w-full object-cover" src={recipe.photoUrl} alt="" />
        ) : (
          <div class="h-2 w-full bg-linear-to-b from-canvas to-surface" />
        )}
        <div class="space-y-1 p-4 pb-3">
          {entry.leftovers && <p class="label text-accent-ink">Leftovers</p>}
          <h2 class="text-xl leading-tight font-semibold">{recipe.title}</h2>
          {/* Cook time is about cooking it. On a reheat it's just wrong. */}
          {recipe.cookTime && !entry.leftovers && (
            <p class="text-sm text-muted">{recipe.cookTime}</p>
          )}
        </div>
      </button>

      {/* Nothing to mark or carry forward on a reheat: it was counted the
          night it was cooked, and leftovers of leftovers is a fridge problem. */}
      {!entry.leftovers && (
        <div class="px-4 pb-3">
          {/* Off for the rest of the day once it's been marked. This is the
              button you walk past all evening, so a second tap is always a
              double tap rather than a second dinner. */}
          <button
            type="button"
            class="btn-primary w-full"
            disabled={busy || alreadyMade}
            onClick={() => onMade(recipe)}
          >
            {alreadyMade ? "Made today" : "Mark made"}
          </button>

          {/* The same quiet inline affordance the plan screen uses to add a
              meal. It's a nudge, not a second primary action. */}
          <button
            type="button"
            class="add-inline mt-1"
            disabled={busy}
            onClick={() => onLeftovers(recipe)}
          >
            <span class="text-sm leading-none">+</span>
            <span>Leftovers tomorrow</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** A second meal on the same day. One line, the same shape the plan uses. */
function AlsoToday({ entry }: { entry: PlanEntry }) {
  const recipe = entry.recipe;

  if (!recipe) {
    return (
      <li class="px-3 py-3 text-row leading-snug text-muted">{entry.note}</li>
    );
  }

  return (
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => navigate(`/recipes/${recipe.id}`)}
      >
        <RecipePhoto
          src={recipe.photoUrl}
          box="size-10 shrink-0 rounded-lg"
          mark="size-5"
        />
        <span class="line-clamp-2 text-row leading-snug font-medium">
          {entry.leftovers && <span class="text-faint">Leftovers · </span>}
          {recipe.title}
        </span>
      </button>
    </li>
  );
}

/**
 * The dashboard the plugin never had. What's for dinner, how the week looks,
 * and how much is still on the list - the three things you open the app for.
 */
export function Home() {
  const today = useToday();
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const monday = useMemo(() => mondayOf(today), [today]);
  const days = useMemo(() => weekDays(monday), [monday]);
  const from = dateKey(monday);
  const to = dateKey(addDays(monday, 6));
  const todayKey = dateKey(today);

  // The week covers today, so the plan fetch answers both the hero and the
  // strip. Two screens' worth of data in two requests.
  const load = useCallback(async () => {
    try {
      const [plan, list] = await Promise.all([api.plan(from, to), api.list()]);
      setEntries(plan.entries);
      setItems(list.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Home is the screen the app opens on, so the sync kicked off at startup
  // usually lands just after this first render. Without the refetch, a recipe
  // planned on the other phone wouldn't show until you navigated away and back.
  useEffect(() => {
    const onSynced = () => void load();
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, [load]);

  const todays = (entries ?? []).filter((entry) => entry.date === todayKey);
  // A recipe wins the hero slot over a free-text note, whatever order they
  // were added in: the photo and the "mark made" are the point of the card.
  const hero = todays.find((entry) => entry.recipe) ?? todays[0] ?? null;
  const rest = todays.filter((entry) => entry !== hero);

  const left = items?.filter((item) => !item.checked).length ?? 0;

  const markMade = async (recipe: PlanRecipe) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.markMade(recipe.id);
      // Every entry for this recipe, not just tonight's: the same dish can be
      // on the plan twice, and it's been made whichever card you tapped.
      setEntries(
        (current) =>
          current?.map((entry) =>
            entry.recipe?.id === recipe.id
              ? { ...entry, recipe: { ...entry.recipe, lastMade: res.lastMade } }
              : entry,
          ) ?? null,
      );
      setStatus(
        `Marked made. That's ${res.timesMade} ${
          res.timesMade === 1 ? "time" : "times"
        }.`,
      );
    } catch (err) {
      // The count lives in the note, so a 409 means the vault moved under us.
      // Say so rather than leaving the tap looking like it worked.
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const leftoversTomorrow = async (recipe: PlanRecipe) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await addLeftoversNextDay(todayKey, recipe);
      setStatus(
        res.added
          ? `Leftovers planned for tomorrow.`
          : `Tomorrow already has those leftovers.`,
      );
      // Tomorrow is in this week unless today is Sunday, and the strip should
      // gain its dot either way.
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Same day-replace the plan screen does: send today as it is plus the new one. */
  const planTonight = async (added: { recipeId?: string; note?: string }) => {
    setBusy(true);
    setPicking(false);
    try {
      await api.setPlanDay(todayKey, [
        // Carry `slot` and `leftovers` through - the day is rewritten whole.
        ...todays.map((entry) => ({
          recipeId: entry.recipe?.id ?? null,
          note: entry.note,
          slot: slotOf(entry),
          leftovers: entry.leftovers,
        })),
        // "Tonight" is dinner by name.
        { ...added, slot: "dinner" as const },
      ]);
      await load();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="screen space-y-3 pb-8">
      <header class="flex items-start justify-between gap-3 px-1 pt-2">
        <div class="min-w-0">
          <h1 class="text-xl leading-tight font-semibold">Tonight</h1>
          <p class="truncate text-sm text-muted">{longDate(today)}</p>
        </div>
        <button
          type="button"
          class="btn-quiet shrink-0"
          onClick={() => navigate("/import")}
        >
          Import
        </button>
      </header>

      {error && <p class="px-1 text-sm text-red-700">{error}</p>}
      {status && (
        <p class="rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      {hero ? (
        <Tonight
          entry={hero}
          busy={busy}
          onMade={(recipe) => void markMade(recipe)}
          onLeftovers={(recipe) => void leftoversTomorrow(recipe)}
        />
      ) : (
        // `entries` is null until the first fetch lands. Drawing "nothing
        // planned" in that gap would be wrong half the time, so hold the space.
        entries !== null && (
          <div class="card space-y-3 p-4">
            <p class="text-sm text-muted">Nothing planned for tonight.</p>
            <button
              type="button"
              class="btn-primary w-full"
              disabled={busy}
              onClick={() => setPicking(true)}
            >
              Pick something
            </button>
          </div>
        )
      )}

      {/* Anything else on today, under the hero. Two dinners is rare; lunch
          plus dinner is not. */}
      {rest.length > 0 && (
        <ul class="card divide-y divide-line overflow-hidden">
          {rest.map((entry) => (
            <AlsoToday key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {/* The week at a glance. Detail is one tap away on the plan screen, so
          this is only "which nights are covered". */}
      <section class="card p-2">
        <div class="flex">
          {days.map((date) => {
            const key = dateKey(date);
            const count = (entries ?? []).filter((e) => e.date === key).length;
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                class="flex-1 rounded-xl py-1.5 active:bg-canvas"
                onClick={() => navigate("/plan")}
              >
                <div class="label leading-none text-faint">{dayName(date)}</div>
                <div
                  class={`mx-auto mt-1.5 grid size-7 place-items-center text-sm leading-none font-semibold ${
                    isToday ? "rounded-full bg-accent text-white" : "text-ink"
                  }`}
                >
                  {date.getDate()}
                </div>
                {/* Fixed height whether or not there are dots, so the strip
                    doesn't shift as the week fills up. */}
                <div class="mt-1.5 flex h-1.5 items-center justify-center gap-0.5">
                  {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                    <span key={i} class="size-1 rounded-full bg-accent" />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        class="card flex w-full items-center gap-3 p-4 text-left active:bg-canvas"
        onClick={() => navigate("/list")}
      >
        <span class="min-w-0 flex-1">
          <span class="block text-row font-medium">Shopping list</span>
          <span class="mt-0.5 block text-sm text-muted">
            {items === null
              ? " "
              : left === 0
                ? "Nothing left to buy"
                : `${left} ${left === 1 ? "thing" : "things"} to buy`}
          </span>
        </span>
        <span class="shrink-0 text-faint">›</span>
      </button>

      {picking && (
        <RecipePicker
          title="Tonight"
          onPick={(recipe: RecipeSummary) =>
            void planTonight({ recipeId: recipe.id })
          }
          onNote={(text) => void planTonight({ note: text })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
