// Deep imports on purpose: the core barrel pulls in cheerio and handlebars,
// which the parser and the renderer need on the Worker but the phone does not.
import { parseRecipeSections } from "@recipe-vault/core/note/sections";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";
import { useEffect, useMemo, useState } from "preact/hooks";

import { api, type RecipeDetail } from "../api";
import { navigate } from "../router";

/** Comma strings out of frontmatter read better with spaces. */
function spaced(value: string | null): string {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * One recipe. The note is the source of truth, so the sections rendered here
 * are parsed out of the markdown with the same core functions the plugin uses
 * for its note actions — no second copy of the note's shape.
 */
export function Recipe({ id }: { id: string }) {
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .recipe(id)
      .then((res) => setRecipe(res.recipe))
      .catch((err) => setError(err.message));
  }, [id]);

  const sections = useMemo(
    () => (recipe ? parseRecipeSections(recipe.markdown) : null),
    [recipe],
  );
  const frontmatter = useMemo(
    () => (recipe ? readFrontmatter(recipe.markdown) : {}),
    [recipe],
  );
  const notes = useMemo(() => notesFromMarkdown(recipe?.markdown ?? ""), [
    recipe,
  ]);

  if (error) return <p class="p-4 text-sm text-red-600">{error}</p>;
  if (!recipe) return null;

  const ingredients = sections?.recipeIngredient ?? [];
  const instructions = sections?.recipeInstructions ?? [];

  // Update from the previous set, not the one captured at render. Two taps in
  // the same tick both read the same stale set otherwise, and the second one
  // silently undoes the first.
  const toggle = (index: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const sendToList = async () => {
    const lines = [...checked].sort((a, b) => a - b).map((i) => ingredients[i]);
    setBusy(true);
    try {
      const res = await api.addToList(lines, recipe.title);
      setChecked(new Set());
      setStatus(
        `${res.added} added, ${res.merged} merged into what was already there.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const markMade = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.markMade(recipe.id);
      setRecipe({ ...recipe, timesMade: res.timesMade, lastMade: res.lastMade });
      setStatus("Marked as made.");
    } catch (err) {
      // A 409 means the note changed in the vault since this page loaded, and
      // the count lives in the note - so say so rather than failing quietly.
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const res = await api.saveRecipe(recipe.id, draft);
      setRecipe(res.recipe);
      setEditing(false);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div class="flex h-full flex-col gap-3 p-4">
        <textarea
          class="min-h-0 flex-1 rounded-lg border border-neutral-300 bg-white p-3 font-mono text-xs"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        />
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg bg-neutral-900 py-2 text-white disabled:opacity-50"
            disabled={busy}
            onClick={saveEdit}
          >
            Save
          </button>
          <button
            type="button"
            class="rounded-lg bg-neutral-200 px-4 py-2"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const meta = [spaced(recipe.mealType), recipe.cookTime, recipe.author]
    .filter(Boolean)
    .join(" · ");

  return (
    <div class="space-y-5 pb-6">
      {recipe.photoUrl && (
        <img class="aspect-video w-full object-cover" src={recipe.photoUrl} alt="" />
      )}

      <div class="space-y-1 px-4">
        <h1 class="text-xl font-semibold">{recipe.title}</h1>
        {meta && <p class="text-sm text-neutral-500">{meta}</p>}
        {recipe.timesMade > 0 && (
          <p class="text-sm text-neutral-400">
            Made {recipe.timesMade}
            {recipe.timesMade === 1 ? " time" : " times"}
            {recipe.lastMade ? `, last on ${recipe.lastMade}` : ""}
          </p>
        )}
      </div>

      <div class="flex gap-2 px-4">
        <button
          type="button"
          class="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy}
          onClick={markMade}
        >
          Mark made
        </button>
        <button
          type="button"
          class="rounded-lg bg-neutral-200 px-4 py-2 text-sm"
          onClick={() => {
            setDraft(recipe.markdown);
            setEditing(true);
          }}
        >
          Edit
        </button>
        {recipe.sourceUrl && (
          <a
            class="rounded-lg bg-neutral-200 px-4 py-2 text-sm"
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        )}
      </div>

      {status && <p class="px-4 text-sm text-neutral-500">{status}</p>}

      <section class="space-y-2 px-4">
        <h2 class="font-semibold">Ingredients</h2>
        {ingredients.length === 0 && (
          <p class="text-sm text-neutral-500">
            This note has no Ingredients section.
          </p>
        )}
        <ul class="space-y-1">
          {ingredients.map((line, i) => (
            <li key={`${line}-${i}`}>
              <label class="flex gap-2 py-1">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={checked.has(i)}
                  onChange={() => toggle(i)}
                />
                <span class="text-sm">{line}</span>
              </label>
            </li>
          ))}
        </ul>
        {checked.size > 0 && (
          <button
            type="button"
            class="w-full rounded-lg bg-neutral-900 py-2 text-white disabled:opacity-50"
            disabled={busy}
            onClick={sendToList}
          >
            Send {checked.size} to the list
          </button>
        )}
      </section>

      {instructions.length > 0 && (
        <section class="space-y-2 px-4">
          <h2 class="font-semibold">Instructions</h2>
          <ol class="list-decimal space-y-2 pl-5 text-sm">
            {instructions.map((step, i) => (
              <li key={`${step}-${i}`}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {notes.length > 0 && (
        <section class="space-y-2 px-4">
          <h2 class="font-semibold">Notes</h2>
          <ul class="list-disc space-y-1 pl-5 text-sm">
            {notes.map((note, i) => (
              <li key={`${note}-${i}`}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <div class="px-4 pt-2">
        <button
          type="button"
          class="text-sm text-red-600"
          onClick={async () => {
            // This removes the note from the vault too, so it needs to say so.
            if (
              !confirm(
                `Delete "${recipe.title}"? This deletes the note from the vault as well.`,
              )
            ) {
              return;
            }
            try {
              await api.deleteRecipe(recipe.id);
              navigate("/recipes");
            } catch (err) {
              setStatus(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Delete recipe
        </button>
      </div>

      {/* `created` is written by the template; show it only if it's there. */}
      {frontmatter.created && (
        <p class="px-4 text-xs text-neutral-400">
          Published {frontmatter.created.slice(0, 10)}
        </p>
      )}
    </div>
  );
}

/** The `## Notes` bullets, if the note has any. */
function notesFromMarkdown(markdown: string): string[] {
  const match = markdown.match(/^##\s+Notes\s*$/m);
  if (!match || match.index === undefined) return [];
  const body = markdown.slice(match.index + match[0].length);
  const next = body.match(/\n##\s+/);
  const section = next?.index !== undefined ? body.slice(0, next.index) : body;
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
