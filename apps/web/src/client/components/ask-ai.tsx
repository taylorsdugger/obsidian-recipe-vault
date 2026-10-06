// Deep imports, like the recipe screen's: the core barrel pulls in cheerio.
import {
  diffLines,
  hasRecipeDiff,
  type ChatMessage,
  type RecipeEditSuggestion,
  type RecipeLists,
} from "@recipe-vault/core/ai/recipe-chat";
import { replaceRecipeSections } from "@recipe-vault/core/note/sections";
import { useEffect, useRef, useState } from "preact/hooks";

import { api, type RecipeDetail } from "../api";
import { Icon } from "./icon";
import { Sheet } from "./sheet";

type EditState =
  | { status: "idle" | "loading" | "unchanged" | "dismissed" }
  | {
      status: "ready" | "applying" | "applied";
      suggestion: RecipeEditSuggestion;
      original: RecipeLists;
    };

type Entry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; offerEdit: boolean; edit: EditState };

const asMessages = (entries: Entry[]): ChatMessage[] =>
  entries.map((entry) => ({
    role: entry.role,
    content: entry.content,
    offeredEdit: entry.role === "assistant" ? entry.offerEdit : undefined,
  }));

/**
 * Ask AI about a recipe, the plugin's modal on the web. Every message is a
 * plain chat reply. When a reply offers a change to the recipe, it gets an
 * "Update the recipe" button; that asks for the edit, shows what it would
 * change, and only then saves. A question never touches the note.
 */
export function AskAi({
  recipe,
  onApplied,
  onClose,
}: {
  recipe: RecipeDetail;
  onApplied: (recipe: RecipeDetail) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Keep the newest reply in view. The sheet owns the scrolling element.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries, thinking]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const busy =
    thinking ||
    entries.some(
      (e) =>
        e.role === "assistant" &&
        (e.edit.status === "loading" || e.edit.status === "applying"),
    );
  let latest = -1;
  entries.forEach((e, i) => {
    if (e.role === "assistant") latest = i;
  });

  const setEdit = (index: number, edit: EditState) =>
    setEntries((prev) =>
      prev.map((e, i) => (i === index && e.role === "assistant" ? { ...e, edit } : e)),
    );

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Entry[] = [...entries, { role: "user", content: text }];
    setEntries(next);
    setDraft("");
    setError(null);
    setThinking(true);
    try {
      const res = await api.aiChat(recipe.id, asMessages(next));
      setEntries([
        ...next,
        {
          role: "assistant",
          content: res.reply,
          offerEdit: res.offerEdit,
          edit: { status: "idle" },
        },
      ]);
    } catch (err) {
      // Put the message back so it isn't lost to a timeout.
      setEntries(entries);
      setDraft(text);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThinking(false);
    }
  };

  const suggest = async (index: number) => {
    setEdit(index, { status: "loading" });
    setError(null);
    try {
      const res = await api.aiEdit(
        recipe.id,
        asMessages(entries.slice(0, index + 1)),
      );
      setEdit(
        index,
        hasRecipeDiff(res.original, res.suggestion)
          ? { status: "ready", ...res }
          : { status: "unchanged" },
      );
    } catch (err) {
      setEdit(index, { status: "idle" });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const apply = async (index: number) => {
    const entry = entries[index];
    if (entry.role !== "assistant" || entry.edit.status !== "ready") return;
    const { suggestion, original } = entry.edit;
    setEdit(index, { status: "applying", suggestion, original });
    setError(null);
    try {
      // Read it again rather than editing the copy this screen loaded:
      // the save checks the vault hasn't moved, not that this page is fresh.
      const fresh = await api.recipe(recipe.id);
      const markdown = replaceRecipeSections(
        fresh.recipe.markdown,
        suggestion.recipeIngredient,
        suggestion.recipeInstructions,
      );
      const saved = await api.saveRecipe(recipe.id, markdown);
      onApplied(saved.recipe);
      setEdit(index, { status: "applied", suggestion, original });
    } catch (err) {
      setEdit(index, { status: "ready", suggestion, original });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Sheet
      title="Ask AI"
      onClose={onClose}
      footer={
        <form
          class="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            rows={1}
            // Grows with what's typed, up to the cap, then scrolls.
            class="field max-h-36 min-h-11 flex-1 resize-none py-2.5 leading-snug field-sizing-content"
            placeholder="Ask about this recipe"
            aria-label="Ask about this recipe"
            enterkeyhint="send"
            value={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line - same as the plugin.
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="submit"
            class="icon-btn-round border-0 bg-ink text-on-ink active:bg-ink/90"
            aria-label="Send"
            disabled={busy || !draft.trim()}
          >
            <Icon name="arrow-up" stroke={2.2} />
          </button>
        </form>
      }
    >
      <div class="space-y-3">
        {entries.length === 0 && (
          <p class="text-row text-muted">
            Ask about {recipe.title}: a substitution, halving it, what to serve
            it with. If the answer is a change to the recipe, you can have it
            written in, and you'll see what changes before anything is saved.
          </p>
        )}

        {entries.map((entry, i) =>
          entry.role === "user" ? (
            <p
              key={i}
              class="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2.5 text-row whitespace-pre-wrap text-accent-ink"
            >
              {entry.content}
            </p>
          ) : (
            <div key={i} class="max-w-[92%] space-y-2.5">
              <p class="card px-3.5 py-2.5 text-row leading-relaxed whitespace-pre-wrap">
                {entry.content}
              </p>
              {entry.offerEdit && (
                <EditOffer
                  edit={entry.edit}
                  live={i === latest}
                  busy={busy}
                  onSuggest={() => void suggest(i)}
                  onApply={() => void apply(i)}
                  onDismiss={() => setEdit(i, { status: "dismissed" })}
                />
              )}
            </div>
          ),
        )}

        {thinking && <p class="text-sm text-muted">Thinking…</p>}
        {error && <p class="text-sm text-danger">{error}</p>}
        <div ref={end} />
      </div>
    </Sheet>
  );
}

/**
 * What hangs off a reply that offered an edit. Only the newest reply's
 * buttons work: an older offer was about a recipe the conversation has
 * since moved past. An applied one keeps saying so.
 */
function EditOffer({
  edit,
  live,
  busy,
  onSuggest,
  onApply,
  onDismiss,
}: {
  edit: EditState;
  live: boolean;
  busy: boolean;
  onSuggest: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  if (edit.status === "applied") {
    return (
      <p class="flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
        <Icon name="check" class="size-4" stroke={2.2} />
        Recipe updated.
      </p>
    );
  }
  if (!live || edit.status === "dismissed") return null;

  if (edit.status === "unchanged") {
    return (
      <p class="text-sm text-muted">
        The AI didn't find anything in the recipe to change.
      </p>
    );
  }

  if (edit.status === "idle" || edit.status === "loading") {
    return (
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-quiet font-semibold"
          disabled={busy}
          onClick={onSuggest}
        >
          <Icon name="edit" class="size-4" />
          {edit.status === "loading" ? "Working it out…" : "Update the recipe"}
        </button>
        <button
          type="button"
          class="px-2 text-sm text-muted underline underline-offset-4"
          disabled={busy}
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    );
  }

  if (!("suggestion" in edit)) return null;
  const { suggestion, original } = edit;
  return (
    <div class="card space-y-3 p-3.5">
      {suggestion.summary && <p class="text-sm">{suggestion.summary}</p>}
      <Changes
        title="Ingredients"
        before={original.recipeIngredient}
        after={suggestion.recipeIngredient}
      />
      <Changes
        title="Steps"
        before={original.recipeInstructions}
        after={suggestion.recipeInstructions}
      />
      <div class="flex gap-2 pt-1">
        <button
          type="button"
          class="btn-primary min-h-11 flex-1 text-sm"
          disabled={edit.status === "applying"}
          onClick={onApply}
        >
          {edit.status === "applying" ? "Saving…" : "Save to the recipe"}
        </button>
        <button
          type="button"
          class="btn-quiet"
          disabled={edit.status === "applying"}
          onClick={onDismiss}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/** One list's removed and added lines. Nothing at all when it didn't change. */
function Changes({
  title,
  before,
  after,
}: {
  title: string;
  before: string[];
  after: string[];
}) {
  const lines = diffLines(before, after);
  if (lines.length === 0) return null;
  return (
    <section class="space-y-1">
      <h3 class="text-note font-semibold text-muted">{title}</h3>
      <ul class="space-y-1 text-sm leading-snug">
        {lines.map((line, i) => (
          <li
            key={i}
            class={`flex gap-2 rounded-lg px-2 py-1 ${
              line.kind === "added"
                ? "bg-accent-soft text-accent-ink"
                : "text-muted line-through"
            }`}
          >
            <span aria-hidden="true" class="font-mono no-underline">
              {line.kind === "added" ? "+" : "−"}
            </span>
            <span class="sr-only">
              {line.kind === "added" ? "Added: " : "Removed: "}
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
