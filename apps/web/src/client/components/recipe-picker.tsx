import { useEffect, useRef, useState } from "preact/hooks";

import { api, type RecipeSummary } from "../api";
import { spaced } from "../format";
import { Sheet } from "./sheet";

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
    const timer = setTimeout(() => {
      api
        .recipes(query.trim(), "alpha")
        .then((res) => {
          if (cancelled) return;
          setRecipes(res.recipes.slice(0, 40));
          setError(null);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const addNote = (event: Event) => {
    event.preventDefault();
    const text = query.trim();
    if (text) onNote(text);
  };

  return (
    <Sheet title={title} onClose={onClose}>
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
            {recipes.map((recipe) => {
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
                    {recipe.photoUrl ? (
                      <img
                        class="size-12 shrink-0 rounded-xl object-cover"
                        src={recipe.photoUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div class="size-12 shrink-0 rounded-xl bg-canvas" />
                    )}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[15px] font-medium">
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
      </div>
    </Sheet>
  );
}
