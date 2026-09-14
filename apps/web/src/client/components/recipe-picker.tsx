import { useEffect, useRef, useState } from "preact/hooks";

import { api, type RecipeSummary } from "../api";
import { spaced } from "../format";
import { RecipePhoto } from "./recipe-photo";
import { Sheet } from "./sheet";

/**
 * How many rows to render at a time. The whole result set arrives in one
 * request - the API already caps it - so this is only about how much DOM the
 * sheet builds up front. More appears as you reach the end.
 */
const PAGE = 40;

/**
 * Pick what's for dinner. Search is the same endpoint the gallery uses, so
 * an ingredient finds a recipe here too. The free-text box under it covers
 * the nights that aren't a recipe: leftovers, out, someone else is cooking.
 */
export function RecipePicker({
  title,
  onPick,
  onNote,
  onClose,
}: {
  title: string;
  onPick: (recipe: RecipeSummary) => void;
  onNote: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const search = useRef<HTMLInputElement>(null);

  // Focus on open, but not on a phone: the keyboard would cover the results
  // before there's anything to scroll, and most picks are from the recent list.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) {
      search.current?.focus();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .recipes(query.trim(), "alpha")
        .then((res) => {
          if (cancelled) return;
          // Replacing the list wholesale is what resets the scroll, so a new
          // result set starts from the top of the sheet on purpose.
          setRecipes(res.recipes);
          setShown(PAGE);
          setError(null);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    };

    // Wait out typing, but not the first open - the sheet shouldn't sit empty
    // for a fifth of a second every time it appears.
    if (recipes === null && !query) {
      load();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(load, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `recipes` is deliberately not a dependency: it only decides whether this
    // is the first load, and depending on it would refetch on every result.
  }, [query]);

  const addNote = (event: Event) => {
    event.preventDefault();
    const text = query.trim();
    if (text) onNote(text);
  };

  return (
    <Sheet
      title={title}
      onClose={onClose}
      onNearEnd={() =>
        setShown((n) => (recipes && n < recipes.length ? n + PAGE : n))
      }
    >
      <div class="space-y-3">
        <input
          ref={search}
          class="field"
          type="search"
          placeholder="Search recipes or ingredients"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />

        {error && <p class="text-sm text-red-700">{error}</p>}

        {/* Whatever's typed doubles as the free-text entry, so "leftovers" is
            one type and one tap rather than a second field to find. */}
        {query.trim() && (
          <form onSubmit={addNote}>
            <button type="submit" class="btn-quiet w-full justify-start">
              Add "{query.trim()}" as a note
            </button>
          </form>
        )}

        {recipes && recipes.length === 0 && (
          <p class="py-8 text-center text-sm text-muted">
            {query ? "Nothing matches that." : "No recipes yet."}
          </p>
        )}

        {recipes && recipes.length > 0 && (
          <ul class="card divide-y divide-line overflow-hidden">
            {recipes.slice(0, shown).map((recipe) => {
              const meta = [spaced(recipe.mealType), recipe.cookTime]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={recipe.id}>
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 p-2.5 text-left"
                    onClick={() => onPick(recipe)}
                  >
                    <RecipePhoto
                      src={recipe.photoUrl}
                      box="size-12 shrink-0 rounded-xl"
                      mark="size-6"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-row font-medium">
                        {recipe.title}
                      </span>
                      {meta && (
                        <span class="block truncate text-xs text-muted">
                          {meta}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {recipes && shown < recipes.length && (
          <div class="py-3 text-center text-xs text-faint">
            {recipes.length - shown} more
          </div>
        )}
      </div>
    </Sheet>
  );
}
