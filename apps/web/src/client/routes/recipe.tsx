// Deep imports on purpose: the core barrel pulls in cheerio and handlebars,
// which the parser and the renderer need on the Worker but the phone does not.
import { parseRecipeSections } from "@recipe-vault/core/note/sections";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";
import { useEffect, useMemo, useState } from "preact/hooks";

import { api, type RecipeDetail } from "../api";
import { shortDate, spaced } from "../format";
import { navigate } from "../router";

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

  if (error) return <p class="p-4 text-sm text-red-700">{error}</p>;
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
        <p class="text-sm text-muted">
          The note itself. Saving writes it back to the vault.
        </p>
        <textarea
          class="min-h-0 flex-1 rounded-2xl border border-line bg-surface p-3 font-mono text-xs leading-relaxed focus:border-accent focus:outline-none"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        />
        {status && <p class="text-sm text-muted">{status}</p>}
        <div class="flex gap-2">
          <button
            type="button"
            class="btn-primary flex-1"
            disabled={busy}
            onClick={saveEdit}
          >
            Save
          </button>
          <button
            type="button"
            class="btn-quiet"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const madeLabel =
    recipe.timesMade > 0
      ? `Made ${recipe.timesMade}${recipe.timesMade === 1 ? " time" : " times"}`
      : null;

  return (
    <div class="pb-28">
      {/* A fixed-height hero rather than the photo's own aspect ratio: these
          come from other people's sites and range from square to tall, and a
          tall one used to push everything below the fold. */}
      <div class="relative">
        {recipe.photoUrl ? (
          <img
            class="h-44 w-full object-cover"
            src={recipe.photoUrl}
            alt=""
          />
        ) : (
          <div class="h-24 w-full bg-linear-to-b from-canvas to-surface" />
        )}
        {recipe.photoUrl && (
          <div class="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-black/45 to-transparent" />
        )}
      </div>

      {/* The content sheet laps over the photo, which hides the crop line and
          gives the title somewhere to sit. */}
      <div class="relative -mt-5 rounded-t-3xl bg-canvas pt-5">
        <div class="space-y-3 px-4">
          <h1 class="text-2xl leading-tight font-semibold">{recipe.title}</h1>

          <div class="flex flex-wrap gap-1.5">
            {spaced(recipe.mealType) && (
              <span class="chip">{spaced(recipe.mealType)}</span>
            )}
            {recipe.cookTime && <span class="chip">{recipe.cookTime}</span>}
            {madeLabel && (
              <span class="chip">
                {madeLabel}
                {recipe.lastMade ? ` · ${shortDate(recipe.lastMade)}` : ""}
              </span>
            )}
          </div>

          {recipe.author && <p class="text-sm text-muted">{recipe.author}</p>}

          <div class="flex gap-2 pt-1">
            <button
              type="button"
              class="btn-primary flex-1"
              disabled={busy}
              onClick={markMade}
            >
              Mark made
            </button>
            <button
              type="button"
              class="btn-quiet"
              onClick={() => {
                setDraft(recipe.markdown);
                setEditing(true);
              }}
            >
              Edit
            </button>
            {recipe.sourceUrl && (
              <a
                class="btn-quiet"
                href={recipe.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            )}
          </div>

          {status && (
            <p class="rounded-xl bg-surface px-3 py-2 text-sm text-muted">
              {status}
            </p>
          )}
        </div>

        <section class="mt-6 space-y-2 px-4">
          <div class="flex items-baseline justify-between">
            <h2 class="text-lg font-semibold">Ingredients</h2>
            {ingredients.length > 0 && (
              <span class="text-sm text-faint">{ingredients.length}</span>
            )}
          </div>

          {ingredients.length === 0 ? (
            <p class="text-sm text-muted">
              This note has no Ingredients section.
            </p>
          ) : (
            <ul class="card divide-y divide-line overflow-hidden">
              {ingredients.map((line, i) => (
                <li key={`${line}-${i}`}>
                  {/* The whole row is the hit area, not the box. */}
                  <label class="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      class="check appearance-none"
                      checked={checked.has(i)}
                      onChange={() => toggle(i)}
                    />
                    <span
                      class={`text-[15px] leading-snug ${
                        checked.has(i) ? "text-faint" : ""
                      }`}
                    >
                      {line}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {instructions.length > 0 && (
          <section class="mt-6 space-y-2 px-4">
            <h2 class="text-lg font-semibold">Instructions</h2>
            <ol class="space-y-3">
              {instructions.map((step, i) => (
                <li key={`${step}-${i}`} class="flex gap-3">
                  <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-ink">
                    {i + 1}
                  </span>
                  <span class="text-[15px] leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {notes.length > 0 && (
          <section class="mt-6 space-y-2 px-4">
            <h2 class="text-lg font-semibold">Notes</h2>
            <ul class="card space-y-2 p-4 text-[15px] leading-relaxed">
              {notes.map((note, i) => (
                <li key={`${note}-${i}`}>{note}</li>
              ))}
            </ul>
          </section>
        )}

        <div class="mt-8 px-4">
          <button
            type="button"
            class="text-sm text-muted underline underline-offset-4"
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

        {frontmatter.created && (
          <p class="mt-3 px-4 text-xs text-faint">
            Published {frontmatter.created.slice(0, 10)}
          </p>
        )}
      </div>

      {/* Sits above the tab bar so the button is reachable with a thumb no
          matter how far down the ingredient list you are. */}
      {checked.size > 0 && (
        <div class="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur">
          <button
            type="button"
            class="btn-primary w-full"
            disabled={busy}
            onClick={sendToList}
          >
            Send {checked.size} to the list
          </button>
        </div>
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
