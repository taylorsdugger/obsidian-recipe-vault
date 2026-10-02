import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";

import type { PublicRecipe } from "../api";
import { bareUrl, mealAndTime, pdfName } from "../format";

/**
 * The PDF. There's no PDF library in the bundle, so this lays the recipe out
 * for one letter page and opens the print dialog, where every browser offers
 * Save as PDF. It sits outside `#app`, which the print stylesheet hides, so
 * the page underneath doesn't print with it.
 *
 * `onDone` fires on `afterprint` rather than when `print()` returns: iOS
 * Safari returns straight away and prints later, and unmounting then would
 * hand it an empty page.
 */
export function RecipePrint({
  recipe,
  shareUrl,
  onDone,
}: {
  recipe: PublicRecipe;
  /** The recipe's public link, when it's on. Printed so the paper leads back. */
  shareUrl?: string;
  onDone: () => void;
}) {
  const printed = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const pageTitle = useRef(document.title);
  const after = useRef(() => done.current());

  // Everything the dialog depends on happens here, not in an effect. The photo
  // is usually cached from the sheet's thumbnail, so its load can fire before
  // any effect has run, and the dialog used to open with the title still
  // "Recipe Vault" and no `afterprint` listener to close it.
  const print = () => {
    if (printed.current) return;
    printed.current = true;
    // The saved file is named after the page title.
    document.title = pdfName(recipe.title);
    window.addEventListener("afterprint", after.current, { once: true });
    window.print();
  };

  useEffect(() => {
    // Wait for the photo, or it prints as a blank box. A slow or dead image
    // shouldn't hold the dialog up for long.
    const fallback = window.setTimeout(print, recipe.photoUrl ? 1500 : 0);
    return () => {
      document.title = pageTitle.current;
      window.removeEventListener("afterprint", after.current);
      window.clearTimeout(fallback);
    };
  }, []);

  const meta = mealAndTime(recipe);
  const today = new Date().toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return createPortal(
    <div class="print-only recipe-print flex flex-col gap-5">
      <div class="grid grid-cols-[minmax(0,1fr)_200px] items-start gap-7">
        <div class="flex flex-col gap-2.5">
          {meta && (
            <span class="text-xs font-bold tracking-[0.1em] text-accent-ink uppercase">
              {meta}
            </span>
          )}
          <h1 class="font-display text-[2.375rem] leading-[1.08] font-medium tracking-[-0.01em]">
            {recipe.title}
          </h1>
          {(recipe.author || recipe.sourceUrl) && (
            <span class="text-sm [overflow-wrap:anywhere] text-muted">
              {recipe.author && `By ${recipe.author}`}
              {recipe.author && recipe.sourceUrl && " · "}
              {recipe.sourceUrl && <PrintLink url={recipe.sourceUrl} />}
            </span>
          )}
        </div>
        {recipe.photoUrl && (
          <img
            class="h-[150px] w-full rounded-[14px] object-cover"
            src={recipe.photoUrl}
            alt=""
            onLoad={print}
            onError={print}
          />
        )}
      </div>

      <div class="h-px bg-line" />

      <div class="grid grid-cols-[230px_minmax(0,1fr)] items-start gap-9">
        <section class="flex flex-col gap-2.5">
          <h2 class="font-display text-[1.375rem] font-medium">Ingredients</h2>
          <ul class="flex flex-col gap-[7px]">
            {recipe.ingredients.map((line, i) => (
              <li key={i} class="flex gap-2.5 text-row leading-[1.35]">
                <span
                  aria-hidden="true"
                  class="mt-[3px] size-3 shrink-0 rounded-[3px] border-[1.5px] border-muted/60"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section class="flex flex-col gap-2.5">
          <h2 class="font-display text-[1.375rem] font-medium">Steps</h2>
          <ol class="flex flex-col gap-[11px]">
            {recipe.steps.map((step, i) => (
              <li key={i} class="flex gap-3">
                <span class="grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] border-accent text-note font-bold text-accent-ink">
                  {i + 1}
                </span>
                <span class="text-base leading-[1.45]">{step}</span>
              </li>
            ))}
          </ol>
          {recipe.notes.length > 0 && (
            <>
              <h2 class="mt-3 font-display text-[1.1875rem] font-medium">
                Notes
              </h2>
              {recipe.notes.map((note, i) => (
                <p key={i} class="text-row leading-[1.45]">
                  {note}
                </p>
              ))}
            </>
          )}
        </section>
      </div>

      <footer class="flex justify-between gap-4 border-t border-line pt-3 text-xs [overflow-wrap:anywhere] text-muted">
        <span class="shrink-0">Shared from Recipe Vault · {today}</span>
        {shareUrl ? (
          <span class="text-right">
            Full recipe: <PrintLink url={shareUrl} />
          </span>
        ) : (
          recipe.sourceUrl && (
            <span class="text-right">
              Original: <PrintLink url={recipe.sourceUrl} />
            </span>
          )
        )}
      </footer>
    </div>,
    document.body,
  );
}

/**
 * A link the PDF keeps clickable. Save as PDF carries `href`s through, and on
 * paper the text is the whole url, so it can still be typed in.
 */
function PrintLink({ url }: { url: string }) {
  return (
    <a class="text-inherit underline underline-offset-2" href={url}>
      {bareUrl(url)}
    </a>
  );
}
