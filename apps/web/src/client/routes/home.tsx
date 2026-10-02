import { useCallback, useEffect, useState } from "preact/hooks";

import {
  api,
  slotOf,
  type ListItem,
  type PlanEntry,
  type PlanRecipe,
  type RecipeSummary,
  type Slot,
} from "../api";
import { Icon } from "../components/icon";
import { RecipePhoto } from "../components/recipe-photo";
import { madeToday, splitAmount } from "../format";
import { RecipePicker } from "../components/recipe-picker";
import { addLeftoversNextDay } from "../leftovers";
import {
  mealTime,
  mealsAfter,
  nextMeal,
  sameMealTime,
  type MealTime,
} from "../meal-time";
import { navigate } from "../router";
import { SYNCED_EVENT } from "../sync";
import { addDays, dateKey, dayName, startOfDay } from "../week";

/**
 * Today and the meal that's up next, re-read whenever the app comes back to
 * the front and once a minute while it's open.
 *
 * Every word on this screen is about what day and what time it is, and an
 * installed PWA left on the kitchen counter is still the same mount at dinner
 * that it was at breakfast. The identity checks keep the same objects when
 * nothing has turned over, so the fetch below doesn't re-run on every tick.
 */
function useMealTime(): { today: Date; meal: MealTime } {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [meal, setMeal] = useState(() => mealTime(new Date()));

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = new Date();
      const day = startOfDay(now);
      setToday((current) =>
        dateKey(current) === dateKey(day) ? current : day,
      );
      const next = mealTime(now);
      setMeal((current) => (sameMealTime(current, next) ? current : next));
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return { today, meal };
}

/** What the header and the picker call a slot. */
const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** How many meals the "Next up" strip shows. Three fit a phone's width. */
const NEXT_UP = 3;

/** "Thursday, October 1", in whatever order the phone's locale puts the two. */
function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * The one meal the screen is built around. The photo and title open the
 * recipe. "Mark made" and the leftovers nudge sit under it, quiet, because
 * the big button at the bottom is cooking it.
 */
function UpNext({
  entry,
  slot,
  leftoversLabel,
  busy,
  onMade,
  onLeftovers,
  onCook,
}: {
  entry: PlanEntry;
  slot: Slot;
  /** "Leftovers tomorrow", or the day's name when the meal is tomorrow's. */
  leftoversLabel: string;
  busy: boolean;
  onMade: (recipe: PlanRecipe) => void;
  onLeftovers: (recipe: PlanRecipe) => void;
  /** Set when there's something to cook. Only the desktop draws it here. */
  onCook?: () => void;
}) {
  const recipe = entry.recipe;
  const alreadyMade = madeToday(recipe?.lastMade ?? null);

  // A free-text night - leftovers, out, someone else is cooking. Nothing to
  // open and nothing to mark, so it's just the words.
  if (!recipe) {
    return (
      <div class="card p-4">
        <p class="font-display text-2xl leading-snug font-medium text-muted">
          {entry.note}
        </p>
      </div>
    );
  }

  // Cook time is about cooking it. On a reheat it's just wrong.
  const meta = [SLOT_LABEL[slot], entry.leftovers ? null : recipe.cookTime]
    .filter(Boolean)
    .join(" · ");

  return (
    <div class="space-y-2.5 lg:space-y-3.5">
      {/* A fixed height, for the same reason the recipe screen's hero has
          one: these photos come from other people's sites and a tall one
          would push everything else off the screen. */}
      <button
        type="button"
        class="block w-full"
        aria-label={`Open ${recipe.title}`}
        onClick={() => navigate(`/recipes/${recipe.id}`)}
      >
        <RecipePhoto
          src={recipe.photoUrl}
          box="h-[200px] w-full rounded-3xl lg:h-[340px]"
          mark="size-16"
        />
      </button>
      {/* On a desktop the buttons come up beside the title. On a phone the
          one that matters is in the dock by the thumb. */}
      <div class="lg:flex lg:items-end lg:justify-between lg:gap-6">
        <button
          type="button"
          class="flex min-w-0 flex-col gap-1 px-1 text-left lg:gap-1.5 lg:px-0"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          <span class="font-display text-[1.5625rem] leading-[1.15] font-medium lg:text-[1.9375rem] lg:leading-[1.1]">
            {recipe.title}
          </span>
          <span class="flex items-center gap-1.5 text-sm text-muted lg:text-row">
            {entry.leftovers && <span class="chip-soft">Leftovers</span>}
            {meta}
          </span>
        </button>
        <div class="hidden shrink-0 gap-2 lg:flex">
          <button
            type="button"
            class="btn-quiet min-h-12 px-5.5 text-row font-semibold"
            onClick={() => navigate(`/recipes/${recipe.id}`)}
          >
            Open recipe
          </button>
          {onCook && (
            <button
              type="button"
              class="btn-primary min-h-12 px-5.5 text-row"
              onClick={onCook}
            >
              <Icon name="flame" class="size-4.5" />
              Start cooking
            </button>
          )}
        </div>
      </div>

      {/* Nothing to mark or carry forward on a reheat: it was counted the
          night it was cooked, and leftovers of leftovers is a fridge problem. */}
      {!entry.leftovers && (
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          {/* Off for the rest of the day once it's been marked. This is the
              button you walk past all evening, so a second tap is always a
              double tap rather than a second dinner. */}
          <button
            type="button"
            class="btn-quiet"
            disabled={busy || alreadyMade}
            onClick={() => onMade(recipe)}
          >
            {alreadyMade ? "Made today" : "Mark made"}
          </button>

          {/* The same quiet inline affordance the plan screen uses to add a
              meal. It's a nudge, not a second primary action. */}
          <button
            type="button"
            class="add-inline"
            disabled={busy}
            onClick={() => onLeftovers(recipe)}
          >
            <Icon name="plus" class="size-4" stroke={2} />
            <span>{leftoversLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One tile in the "Next up" strip. The label is when: the slot for later the
 * same day, the weekday after that.
 */
function NextTile({ entry, sameDay }: { entry: PlanEntry; sameDay: boolean }) {
  const slot = slotOf(entry);
  const date = new Date(`${entry.date}T00:00:00`);
  const when = sameDay
    ? SLOT_LABEL[slot]
    : // Dinner is the default, so only the other two get named.
      [dayName(date), slot === "dinner" ? null : SLOT_LABEL[slot]]
        .filter(Boolean)
        .join(" · ");
  const recipe = entry.recipe;

  return (
    // A tile in a sideways strip on a phone. On a desktop the strip is a
    // column beside the hero, so each one turns into a row with a thumbnail.
    <button
      type="button"
      class="flex w-34 shrink-0 flex-col gap-1.5 text-left lg:min-h-15 lg:w-full lg:flex-row lg:items-center lg:gap-3.5"
      onClick={() => navigate(recipe ? `/recipes/${recipe.id}` : "/plan")}
    >
      <RecipePhoto
        src={recipe?.photoUrl ?? null}
        box="h-[92px] w-full rounded-2xl lg:size-13 lg:shrink-0 lg:rounded-[14px]"
        mark="size-10 lg:size-6"
      />
      <span class="flex min-w-0 flex-col gap-1.5 lg:gap-0.5">
        <span class="label text-muted">
          {when}
          {entry.leftovers && " · Leftovers"}
        </span>
        <span
          class={`line-clamp-2 text-sm leading-[1.3] font-semibold lg:line-clamp-1 lg:text-row ${
            recipe ? "" : "text-muted"
          }`}
        >
          {recipe ? recipe.title : entry.note}
        </span>
      </span>
    </button>
  );
}

/** How many rows the desktop's list card shows before "Open". */
const LIST_PREVIEW = 5;

/**
 * The top of the shopping list, tickable, for the desktop's right column.
 * A phone has the one-line link instead: there's no room for both this and
 * the meal, and the list is a tap away.
 */
function ListCard({
  items,
  left,
  onToggle,
}: {
  items: ListItem[];
  left: number;
  onToggle: (item: ListItem) => void;
}) {
  // Rows ticked here stay put until the screen reloads, so the next one
  // doesn't slide up under the pointer.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const shown = items
    .filter((item) => !item.checked || ticked.has(item.id))
    .slice(0, LIST_PREVIEW);
  return (
    <section class="card flex flex-col gap-1 px-3 pt-4 pb-3">
      <div class="flex items-baseline justify-between px-1 pb-1.5">
        <h2 class="text-row font-semibold">
          Shopping list{left > 0 && ` · ${left} to get`}
        </h2>
        <button
          type="button"
          class="-my-2 py-2 text-sm font-semibold text-accent-ink"
          onClick={() => navigate("/list")}
        >
          Open
        </button>
      </div>
      {shown.length === 0 ? (
        <p class="px-1 pb-1 text-sm text-muted">Nothing left to get.</p>
      ) : (
        shown.map((item) => {
          const { amount, name } = splitAmount(item);
          return (
            <label key={item.id} class="check-row min-h-12 py-1">
              <input
                type="checkbox"
                class="check appearance-none"
                checked={item.checked}
                onChange={() => {
                  setTicked((current) => new Set(current).add(item.id));
                  onToggle(item);
                }}
              />
              <span
                class={`min-w-0 flex-1 truncate text-row ${
                  item.checked ? "text-muted line-through" : ""
                }`}
              >
                {name}
              </span>
              {amount && (
                <span class="shrink-0 text-note text-muted tabular-nums">
                  {amount}
                </span>
              )}
            </label>
          );
        })
      )}
    </section>
  );
}

/**
 * The dashboard the plugin never had. What's for dinner, what's after it,
 * and how much is still on the list - the three things you open the app for.
 */
export function Home() {
  const { today, meal } = useMealTime();
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const todayKey = dateKey(today);
  const dayKey = dateKey(meal.day);
  const isTomorrow = dayKey !== todayKey;
  // A week ahead from today rather than this Monday to Sunday, so "Next up"
  // still has something in it on a Saturday night.
  const from = todayKey;
  const to = dateKey(addDays(today, 7));

  // One fetch answers the hero and the strip. Two screens' worth of data in
  // two requests.
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

  // Everything on the day the next meal is on. Usually today, tomorrow once
  // dinner's done.
  const dayEntries = (entries ?? []).filter((entry) => entry.date === dayKey);
  const hero = nextMeal(dayEntries, dayKey, meal.slot);
  // The header names the meal on the card. With nothing planned it names the
  // slot "Pick something" would fill.
  const heroSlot = hero ? slotOf(hero) : meal.slot;
  const upcoming = mealsAfter(entries ?? [], hero, dayKey, heroSlot, NEXT_UP);
  const title =
    heroSlot === "dinner" && !isTomorrow ? "Tonight" : SLOT_LABEL[heroSlot];

  const left = items?.filter((item) => !item.checked).length ?? 0;

  // Ticked from the desktop's list card, drawn ticked straight away.
  const toggleItem = async (item: ListItem) => {
    const next = !item.checked;
    setItems(
      (current) =>
        current?.map((i) => (i.id === item.id ? { ...i, checked: next } : i)) ??
        null,
    );
    try {
      await api.setChecked(item.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    }
  };

  const markMade = async (recipe: PlanRecipe) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.markMade(recipe.id);
      // Every entry for this recipe, not just the one on the card: the same
      // dish can be on the plan twice, and it's been made whichever you tapped.
      setEntries(
        (current) =>
          current?.map((entry) =>
            entry.recipe?.id === recipe.id
              ? {
                  ...entry,
                  recipe: { ...entry.recipe, lastMade: res.lastMade },
                }
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

  // The day after the hero's, which is the day after tomorrow once the hero
  // is tomorrow's.
  const leftoversDay = isTomorrow
    ? addDays(meal.day, 1).toLocaleDateString(undefined, { weekday: "long" })
    : "tomorrow";

  const leftoversNextDay = async (recipe: PlanRecipe, slot: Slot) => {
    setBusy(true);
    setStatus(null);
    try {
      // Same slot it was cooked in, so lunch leftovers stay lunch.
      const res = await addLeftoversNextDay(dayKey, recipe, slot);
      setStatus(
        res.added
          ? `Leftovers planned for ${leftoversDay}.`
          : `${leftoversDay[0].toUpperCase()}${leftoversDay.slice(1)} already has those leftovers.`,
      );
      // The strip should pick the new meal up either way.
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Same day-replace the plan screen does: send the day as it is plus the new one. */
  const planMeal = async (added: { recipeId?: string; note?: string }) => {
    setBusy(true);
    setPicking(false);
    try {
      await api.setPlanDay(dayKey, [
        // Carry `slot` and `leftovers` through - the day is rewritten whole.
        ...dayEntries.map((entry) => ({
          recipeId: entry.recipe?.id ?? null,
          note: entry.note,
          slot: slotOf(entry),
          leftovers: entry.leftovers,
        })),
        { ...added, slot: meal.slot },
      ]);
      await load();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The dock holds whatever the hero is waiting on. Cooking it, or picking
  // something when nothing's planned. A note or a reheat has nothing to
  // start, so there's no bar at all.
  const cookable = hero?.recipe && !hero.leftovers ? hero.recipe : null;
  const docked = !!cookable || (entries !== null && !hero);

  return (
    <div
      class={`screen space-y-[22px] lg:space-y-6 lg:pb-12 ${docked ? "pb-28" : "pb-8"}`}
    >
      <header class="screen-title -mb-1.5">
        <div class="min-w-0">
          <p class="truncate text-note text-muted">
            {isTomorrow && "Tomorrow · "}
            {longDate(meal.day)}
          </p>
          <h1 class="title-display">{title}</h1>
        </div>
        <button
          type="button"
          class="btn-quiet shrink-0"
          onClick={() => navigate("/import")}
        >
          Import
        </button>
      </header>

      {error && <p class="px-1 text-sm text-danger">{error}</p>}
      {status && (
        <p class="rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      <div class="space-y-[22px] lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
        <div>
          {hero ? (
            <UpNext
              entry={hero}
              slot={heroSlot}
              leftoversLabel={`Leftovers ${leftoversDay}`}
              busy={busy}
              onMade={(recipe) => void markMade(recipe)}
              onLeftovers={(recipe) => void leftoversNextDay(recipe, heroSlot)}
              onCook={
                cookable
                  ? () => navigate(`/recipes/${cookable.id}/cook`)
                  : undefined
              }
            />
          ) : (
            // `entries` is null until the first fetch lands. Drawing "nothing
            // planned" in that gap would be wrong half the time, so hold the space.
            entries !== null && (
              <div class="card p-4">
                <p class="text-sm text-muted">
                  Nothing planned for {meal.slot}
                  {isTomorrow ? " tomorrow" : ""}.
                </p>
                {/* The dock's button, for a desktop that has no dock. */}
                <button
                  type="button"
                  class="btn-primary mt-3 hidden min-h-12 lg:inline-flex"
                  disabled={busy}
                  onClick={() => setPicking(true)}
                >
                  <Icon name="plus" stroke={2} />
                  Pick something
                </button>
              </div>
            )
          )}
        </div>

        <div class="space-y-[22px] lg:space-y-6">
          {/* What's after it. Detail is one tap away on the plan screen, so this
          is only "what's coming", a few meals deep. */}
          {upcoming.length > 0 && (
            <section class="space-y-2.5 lg:space-y-2">
              <div class="flex items-baseline justify-between px-1 lg:px-0">
                <h2 class="text-row font-semibold">Next up</h2>
                <button
                  type="button"
                  class="-my-2 py-2 text-sm font-semibold text-accent-ink"
                  onClick={() => navigate("/plan")}
                >
                  Week
                </button>
              </div>
              {/* Runs off the right edge, so a fourth would read as "scroll for
              more" if the plan ever grows one. */}
              <div class="-mr-4 flex gap-2.5 overflow-x-auto pr-4 lg:mr-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:pr-0">
                {upcoming.map((entry) => (
                  <NextTile
                    key={entry.id}
                    entry={entry}
                    sameDay={entry.date === dayKey}
                  />
                ))}
              </div>
            </section>
          )}

          <button
            type="button"
            class="card flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-canvas lg:hidden"
            onClick={() => navigate("/list")}
          >
            <Icon name="list" class="size-5 text-accent-ink" />
            <span class="min-w-0 flex-1 text-row font-semibold">
              Shopping list
            </span>
            <span class="shrink-0 text-sm text-muted">
              {items === null
                ? ""
                : left === 0
                  ? "Nothing left"
                  : `${left} to get`}
            </span>
            <Icon name="chevron-right" class="size-[18px] text-muted" />
          </button>
          {items !== null && (
            <div class="hidden lg:block">
              <ListCard
                items={items}
                left={left}
                onToggle={(item) => void toggleItem(item)}
              />
            </div>
          )}
        </div>
      </div>

      {docked && (
        <div class="action-bar lg:hidden">
          <div class="mx-auto w-full max-w-2xl">
            {cookable ? (
              <button
                type="button"
                class="btn-primary w-full text-step"
                onClick={() => navigate(`/recipes/${cookable.id}/cook`)}
              >
                <Icon name="flame" />
                Start cooking
              </button>
            ) : (
              <button
                type="button"
                class="btn-primary w-full text-step"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                <Icon name="plus" stroke={2} />
                Pick something
              </button>
            )}
          </div>
        </div>
      )}

      {picking && (
        <RecipePicker
          title={SLOT_LABEL[meal.slot]}
          onPick={(recipe: RecipeSummary) =>
            void planMeal({ recipeId: recipe.id })
          }
          onNote={(text) => void planMeal({ note: text })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
