import { useEffect, useRef, useState } from "preact/hooks";

import { api, type ParsedRecipePreview } from "../api";
import { VaultImport } from "../components/vault-import";
import { navigate } from "../router";

/** Read a parsed value that may be a string, or anything else, as text. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Pull a URL out of the share target's query string. Android hands the shared
 * link over in `url` when the app shares a proper URL, but Chrome's own share
 * puts the whole thing in `text`, sometimes as "Page title https://…". So take
 * `url` if it's there and otherwise dig the first link out of `text`.
 */
function sharedUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const direct = params.get("url");
  if (direct) return direct.trim();

  const text = params.get("text") ?? "";
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : "";
}

/** URL field, preview card, save. The share target lands here too (2e.6). */
export function Import() {
  const [url, setUrl] = useState(sharedUrl);
  const [preview, setPreview] = useState<ParsedRecipePreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async (target: string) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await api.importPreview(target.trim());
      setPreview(res.recipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const lookUp = (event: Event) => {
    event.preventDefault();
    void look(url);
  };

  // Arriving from the share sheet: look the URL up without a second tap, and
  // drop the query string so a reload doesn't re-import.
  const shared = useRef(false);
  useEffect(() => {
    if (shared.current) return;
    shared.current = true;
    const fromShare = sharedUrl();
    if (!fromShare) return;
    window.history.replaceState({}, "", "/import");
    void look(fromShare);
  }, []);

  const save = async (recipe: ParsedRecipePreview) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.importSave(recipe);
      navigate(`/recipes/${res.recipe.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div class="space-y-4 p-4">
      <h1 class="text-xl font-semibold">Import a recipe</h1>

      <form class="flex gap-2" onSubmit={lookUp}>
        <input
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        />
        <button
          class="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          type="submit"
          disabled={busy || url.trim().length === 0}
        >
          {busy ? "…" : "Look up"}
        </button>
      </form>

      {error && <p class="text-sm text-red-600">{error}</p>}

      {!preview && <VaultImport onDone={() => undefined} />}

      {preview?.map((recipe, i) => {
        const name = asText(recipe.name) || "Untitled recipe";
        const image = asText(recipe.image);
        const ingredients = recipe.recipeIngredient ?? [];
        return (
          <div
            key={`${name}-${i}`}
            class="space-y-3 overflow-hidden rounded-xl border border-neutral-200 bg-white"
          >
            {image && (
              <img class="aspect-video w-full object-cover" src={image} alt="" />
            )}
            <div class="space-y-2 px-4">
              <h2 class="font-medium">{name}</h2>
              {asText(recipe.author) && (
                <p class="text-sm text-neutral-500">{asText(recipe.author)}</p>
              )}
              <p class="text-sm text-neutral-500">
                {ingredients.length} ingredients,{" "}
                {recipe.recipeInstructions?.length ?? 0} steps
              </p>
            </div>
            <div class="px-4 pb-4">
              <button
                type="button"
                class="w-full rounded-lg bg-neutral-900 py-2 text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => save(recipe)}
              >
                Save
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
