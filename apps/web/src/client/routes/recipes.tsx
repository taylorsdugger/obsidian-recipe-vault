import { useEffect, useState } from "preact/hooks";

import { api, type RecipeSort, type RecipeSummary } from "../api";
import { RecipeCard } from "../components/recipe-card";
import { navigate } from "../router";
import { SYNCED_EVENT } from "../sync";

const SORTS: { key: RecipeSort; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "made", label: "Most made" },
  { key: "quick", label: "Quickest" },
];

/**
 * The gallery. Search covers title, meal type, and ingredients — the same
 * three fields the plugin filters on, except the matching happens in SQL.
 */
export function Recipes() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RecipeSort>("recent");
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [syncTick, setSyncTick] = useState(0);

  // A background sync that changed something means this list is stale.
  useEffect(() => {
    const onSynced = () => setSyncTick((n) => n + 1);
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Wait out the typing before hitting the API on every keystroke.
    const timer = setTimeout(() => {
      api
        .recipes(query.trim(), sort)
        .then((res) => {
          if (!cancelled) {
            setRecipes(res.recipes);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sort, syncTick]);

  return (
    <div class="space-y-4 p-4">
      <div class="space-y-3">
        <div class="flex gap-2">
          <input
            class="field min-w-0 flex-1"
            type="search"
            placeholder="Search recipes, meal types, ingredients"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
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
              class={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                sort === option.key
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-surface text-muted"
              }`}
              onClick={() => setSort(option.key)}
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
