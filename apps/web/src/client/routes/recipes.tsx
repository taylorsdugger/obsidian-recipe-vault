import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { api, type RecipeSort, type RecipeSummary } from "../api";
import { Icon } from "../components/icon";
import { RecipeCard } from "../components/recipe-card";
import { navigate } from "../router";
import { rememberScroll, restoreScroll, scrollToTop } from "../scroll";
import { SYNCED_EVENT } from "../sync";

const SCROLL_KEY = "recipes";

/**
 * The search box and sort live outside the component so they survive opening a
 * recipe and coming back. Restoring the scroll position without these would
 * put you at the same offset in a different list - you searched for "soup",
 * scrolled, tapped one, and came back to the whole gallery at soup's offset.
 */
let lastQuery = "";
let lastSort: RecipeSort = "alpha";

// A-Z is still the default. It's last in the row because it's the one you
// don't have to ask for.
const SORTS: { key: RecipeSort; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "made", label: "Most made" },
  { key: "quick", label: "Quickest" },
  { key: "alpha", label: "A-Z" },
];

/**
 * The gallery. Search covers title, meal type, and ingredients — the same
 * three fields the plugin filters on, except the matching happens in SQL.
 */
export function Recipes() {
  const [query, setQuery] = useState(lastQuery);
  const [sort, setSort] = useState<RecipeSort>(lastSort);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Restore once, on the first render that actually has rows in it. */
  const restored = useRef(false);

  const [syncTick, setSyncTick] = useState(0);

  // Remember where we were on the way out - opening a recipe unmounts this.
  useEffect(() => {
    lastQuery = query;
    lastSort = sort;
  }, [query, sort]);

  useEffect(() => () => rememberScroll(SCROLL_KEY), []);

  /**
   * Before the browser paints, not after, or the list flashes at the top for a
   * frame. The guard means a new search starts at the top the way it should,
   * and only coming back to the screen restores.
   */
  useLayoutEffect(() => {
    if (!recipes) return;
    if (restored.current) return;
    restored.current = true;
    if (!restoreScroll(SCROLL_KEY)) scrollToTop();
  }, [recipes]);

  // A background sync that changed something means this list is stale.
  useEffect(() => {
    const onSynced = () => setSyncTick((n) => n + 1);
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Wait out the typing before hitting the API on every keystroke.
    const timer = window.setTimeout(() => {
      api
        .recipes(query.trim(), sort)
        .then((res) => {
          if (!cancelled) {
            setRecipes(res.recipes);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setError(err instanceof Error ? err.message : String(err));
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sort, syncTick]);

  // A different search is a different list; the old offset means nothing in it.
  const changeQuery = (next: string) => {
    setQuery(next);
    if (restored.current) scrollToTop();
  };

  // With a search typed it's how many matched, which is what you want to
  // know about the list you're looking at.
  const count =
    recipes === null
      ? "\u00a0"
      : query.trim()
        ? `${recipes.length} ${recipes.length === 1 ? "match" : "matches"}`
        : `${recipes.length} saved`;

  const searchPlaceholder =
    recipes && !query.trim()
      ? `Search ${recipes.length} recipes`
      : "Search recipes";

  return (
    // Clears the search bar docked above the tab bar.
    <div class="screen-wide space-y-4 pb-28 lg:space-y-5 lg:pb-12">
      <header class="space-y-3">
        <div class="screen-title pb-0">
          <div class="min-w-0">
            <p class="truncate text-note text-muted">{count}</p>
            <h1 class="title-display">Recipes</h1>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            {/* The dock's search, up in the header where a desktop looks. */}
            <label class="hidden h-11.5 w-80 items-center gap-2.5 rounded-full border border-line bg-surface px-4.5 text-muted focus-within:border-accent lg:flex">
              <Icon name="search" class="size-4.5" />
              <input
                class="h-10 min-w-0 flex-1 bg-transparent text-row text-ink placeholder:text-muted focus:outline-none"
                type="search"
                aria-label="Search recipes, meal types and ingredients"
                placeholder={searchPlaceholder}
                value={query}
                onInput={(e) =>
                  changeQuery((e.target as HTMLInputElement).value)
                }
              />
            </label>
            <button
              type="button"
              class="btn-quiet shrink-0"
              onClick={() => navigate("/import")}
            >
              Import
            </button>
          </div>
        </div>
        {/* Runs off the right edge on a phone and scrolls sideways, rather
            than wrapping to a second row of pills. */}
        <div class="-mr-4 flex gap-1.5 overflow-x-auto pr-4 sm:mr-0 sm:pr-0">
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              class={sort === option.key ? "pill-on" : "pill"}
              aria-pressed={sort === option.key}
              onClick={() => {
                setSort(option.key);
                scrollToTop();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p class="text-sm text-danger">{error}</p>}

      {recipes && recipes.length === 0 && (
        <div class="space-y-3 py-8 text-center">
          <p class="text-sm text-muted">
            {query ? "Nothing matches that." : "No recipes yet."}
          </p>
          {!query && (
            <button
              type="button"
              class="btn-primary"
              onClick={() => navigate("/import")}
            >
              Import one
            </button>
          )}
        </div>
      )}

      {recipes && recipes.length > 0 && (
        <div class="grid grid-cols-2 gap-x-3 gap-y-[18px] sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-6">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onOpen={(id) => navigate(`/recipes/${id}`)}
            />
          ))}
        </div>
      )}

      {/* Search lives at the bottom, by the thumb. It covers title, meal type
          and ingredients, so "chickpea" finds the curry. */}
      <div class="action-bar lg:hidden">
        <label class="field-round mx-auto flex max-w-2xl items-center gap-2.5 text-muted focus-within:border-accent">
          <Icon name="search" />
          <input
            class="h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
            type="search"
            aria-label="Search recipes, meal types and ingredients"
            placeholder={searchPlaceholder}
            value={query}
            onInput={(e) => changeQuery((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
    </div>
  );
}
