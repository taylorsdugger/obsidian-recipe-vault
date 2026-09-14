import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { api, type RecipeSort, type RecipeSummary } from "../api";
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

const SORTS: { key: RecipeSort; label: string }[] = [
  { key: "alpha", label: "A-Z" },
  { key: "recent", label: "Recent" },
  { key: "made", label: "Most made" },
  { key: "quick", label: "Quickest" },
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

  return (
    <div class="screen-wide space-y-4">
      <div class="space-y-3">
        <div class="flex gap-2">
          <input
            class="field min-w-0 flex-1"
            type="search"
            placeholder="Search recipes, meal types, ingredients"
            value={query}
            onInput={(e) => changeQuery((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn-primary shrink-0"
            onClick={() => navigate("/import")}
          >
            Import
          </button>
        </div>
        <div class="flex gap-2">
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              class={sort === option.key ? "pill-on" : "pill"}
              onClick={() => {
                setSort(option.key);
                scrollToTop();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p class="text-sm text-red-700">{error}</p>}

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
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onOpen={(id) => navigate(`/recipes/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
