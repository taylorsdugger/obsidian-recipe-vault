import { useEffect, useState } from "preact/hooks";

import { api, type PublicRecipe } from "../api";
import { mealAndTime } from "../format";
import { useScrollLock } from "../scroll";
import { Icon } from "./icon";
import { RecipePhoto } from "./recipe-photo";
import { RecipePrint } from "./recipe-print";

/**
 * Share a recipe: a public link, or a PDF.
 *
 * The link is off until someone turns it on here. Opening the sheet doesn't
 * make one, so looking at the options never publishes anything. Turning it off
 * deletes the token, and turning it back on makes a new one, so a link that
 * went to the wrong group chat stays dead.
 *
 * A sheet from the bottom on a phone; from `md` up a dialog in the middle of
 * the window, where a sheet would stretch across the whole thing.
 */
export function ShareSheet({
  id,
  recipe,
  onClose,
}: {
  id: string;
  recipe: PublicRecipe;
  onClose: () => void;
}) {
  /** undefined while it loads, null while the link is off. */
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useScrollLock();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api
      .share(id)
      .then((res) => setToken(res.token))
      .catch((err: unknown) => {
        setToken(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [id]);

  const url = token ? `${window.location.origin}/s/${token}` : "";

  const run = async (work: () => Promise<{ token: string | null }>) => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setToken((await work()).token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it instead.");
    }
  };

  // The phone's own share sheet: Messages, WhatsApp, AirDrop. Cancelling it
  // throws, which isn't an error worth showing.
  const canSend = typeof navigator.share === "function";
  const send = () => {
    navigator.share({ title: recipe.title, url }).catch(() => {});
  };

  const meta = mealAndTime(recipe);

  return (
    <div class="fixed inset-0 z-30 flex flex-col justify-end md:items-center md:justify-center md:p-6">
      <button
        type="button"
        aria-label="Close share"
        class="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        class="relative flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-line bg-canvas px-5 pt-2.5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-xl md:max-w-[480px] md:gap-[18px] md:rounded-3xl md:border md:p-6"
      >
        <span
          aria-hidden="true"
          class="h-[5px] w-9 self-center rounded-full bg-line md:hidden"
        />
        <div class="flex items-center justify-between">
          <h2
            id="share-title"
            class="font-display text-[1.625rem] font-medium md:text-[1.75rem]"
          >
            Share recipe
          </h2>
          <button
            type="button"
            aria-label="Close"
            class="-mr-2 grid size-11 place-items-center rounded-full text-muted md:-mr-2.5"
            onClick={onClose}
          >
            <Icon name="close" stroke={2} />
          </button>
        </div>

        <div class="flex items-center gap-3">
          <RecipePhoto
            src={recipe.photoUrl}
            box="size-12 shrink-0 rounded-xl"
            mark="size-7"
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-row font-semibold">{recipe.title}</span>
            {meta && <span class="text-note text-muted">{meta}</span>}
          </span>
        </div>

        <section class="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-row font-semibold">
              <Icon name="link" class="size-[18px]" />
              Public link
            </span>
            {token !== undefined && (
              <span
                class={`flex h-6 items-center rounded-full px-2.5 text-xs font-bold ${
                  token
                    ? "bg-accent-soft text-accent-ink"
                    : "bg-line text-muted"
                }`}
              >
                {token ? "On" : "Off"}
              </span>
            )}
          </div>

          {token ? (
            <div class="flex gap-2">
              <label for="share-url" class="sr-only">
                Share link
              </label>
              <input
                id="share-url"
                class="field h-12 min-w-0 flex-1 rounded-[14px] bg-canvas text-row md:h-[46px]"
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                class="btn-primary min-h-12 shrink-0 gap-1.5 px-[18px] text-row md:min-h-[46px]"
                onClick={() => void copy()}
              >
                <Icon
                  name={copied ? "check" : "copy"}
                  class="size-4"
                  stroke={2}
                />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            token === null && (
              <button
                type="button"
                class="btn-primary min-h-12 text-row"
                disabled={busy}
                onClick={() => void run(() => api.startShare(id))}
              >
                Create link
              </button>
            )
          )}

          <p class="text-note leading-[1.45] text-muted">
            Anyone with this link can view the recipe and use cook mode. Times
            made and your meal plan aren't shared.
          </p>

          {token && (
            <button
              type="button"
              class="-my-2 -ml-1 min-h-11 self-start px-1 text-sm font-semibold underline underline-offset-[3px] disabled:opacity-40 md:min-h-10"
              disabled={busy}
              onClick={() => void run(() => api.stopShare(id))}
            >
              Turn off link
            </button>
          )}

          {error && <p class="text-sm text-danger">{error}</p>}
        </section>

        {/* The phone: send and download side by side, under the thumb. */}
        <div
          class={`grid gap-2 md:hidden ${token && canSend ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {token && canSend && (
            <button
              type="button"
              class="btn-quiet min-h-[52px] text-row font-semibold"
              onClick={send}
            >
              <Icon name="share" class="size-[18px]" />
              Send link
            </button>
          )}
          <button
            type="button"
            class="btn-quiet min-h-[52px] text-row font-semibold"
            disabled={printing}
            onClick={() => setPrinting(true)}
          >
            <Icon name="pdf" class="size-[18px]" />
            Download PDF
          </button>
        </div>

        {/* A desktop has the room to say what the PDF is. */}
        <section class="hidden items-center gap-3.5 rounded-[20px] border border-line bg-surface px-4 py-3.5 md:flex">
          <Icon name="pdf" class="size-[22px]" />
          <span class="flex flex-1 flex-col gap-0.5">
            <span class="text-row font-semibold">PDF</span>
            <span class="text-note text-muted">
              Opens the print dialog. Save as PDF from there.
            </span>
          </span>
          <button
            type="button"
            class="btn-quiet bg-canvas font-semibold"
            disabled={printing}
            onClick={() => setPrinting(true)}
          >
            Download
          </button>
        </section>
      </div>

      {printing && (
        <RecipePrint
          recipe={recipe}
          shareUrl={url || undefined}
          onDone={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
