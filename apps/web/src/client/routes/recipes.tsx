import { useEffect, useState } from "preact/hooks";

import { api, type RecipeSort, type RecipeSummary } from "../api";
import { RecipeCard } from "../components/recipe-card";
import { navigate } from "../router";

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
  }, [query, sort]);

  return (
    <div class="space-y-4 p-4">
      <div class="space-y-3">
        <div class="flex gap-2">
          <input
            class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2"
            type="search"
            placeholder="Search recipes, meal types, ingredients"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-white"
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
              class={`rounded-full px-3 py-1 text-sm ${
                sort === option.key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-200 text-neutral-700"
              }`}
              onClick={() => setSort(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p class="text-sm text-red-600">{error}</p>}

      {recipes && recipes.length === 0 && (
        <div class="space-y-3 py-8 text-center">
          <p class="text-sm text-neutral-500">
            {query ? "Nothing matches that." : "No recipes yet."}
          </p>
          {!query && (
            <button
              type="button"
              class="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white"
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
