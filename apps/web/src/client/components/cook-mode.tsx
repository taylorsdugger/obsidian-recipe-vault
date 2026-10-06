// Deep import, like the recipe screen's: the core barrel pulls in cheerio.
import { ingredientsForSteps } from "@recipe-vault/core/note/step-ingredients";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { useScrollLock } from "../scroll";
import { Icon } from "./icon";
import { Sheet } from "./sheet";

/**
 * One step at a time, big enough to read from across the counter.
 *
 * The step being done is the only thing at full size. Under it, the
 * ingredients it calls for, so there's no flicking back to the list with a
 * floury thumb. At the bottom a card says what comes next, two lines of it,
 * which is what tells you to get the pan hot now rather than after you've
 * read on.
 *
 * The wake lock isn't taken here. The recipe screen underneath already holds
 * one for as long as it's open, and cook mode is drawn over it rather than
 * replacing it, so the lock carries straight through. `screenAwake` is only
 * whether to say so.
 */
export function CookMode({
  title,
  steps,
  ingredients,
  step,
  screenAwake,
  onStep,
  onClose,
  onDone,
}: {
  title: string;
  steps: string[];
  ingredients: string[];
  /** Held by the recipe screen, so leaving and coming back resumes. */
  step: number;
  screenAwake: boolean;
  onStep: (step: number) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useScrollLock();

  const n = Math.min(Math.max(step, 0), steps.length - 1);
  const last = n === steps.length - 1;
  const text = steps[n] ?? "";
  const usesBySteps = useMemo(
    () => ingredientsForSteps(steps, ingredients),
    [steps, ingredients],
  );
  const uses = usesBySteps[n] ?? [];

  // Big enough to read from across the counter, but a long step at that size
  // turns into a wall of display type. Past a couple of lines it steps down.
  const long = text.length > 140;

  // Said in words, under the step's own ingredients. The list icon in the
  // phone's top bar on its own didn't say what it opened, and the desktop
  // had no way to the whole list at all. There on every step, since not
  // every step has ingredients matched to it.
  const showAll = ingredients.length > 0 && (
    <button
      type="button"
      class="btn-quiet min-h-9 self-start px-3.5 text-note text-muted"
      onClick={() => setListOpen(true)}
    >
      Show all ingredients
    </button>
  );

  const next = () => (last ? onDone() : onStep(n + 1));
  const prev = () => onStep(Math.max(0, n - 1));

  // A long step scrolls inside the step area. The next one starts at its top.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [n]);

  // Arrow keys on a laptop propped on the counter, Escape to put it away. Not
  // while the ingredients sheet is up - it has its own Escape.
  useEffect(() => {
    if (listOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
      else if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      class="cook"
      role="dialog"
      aria-modal="true"
      aria-label={`Cooking ${title}`}
    >
      {/* The desktop's layout: the step with the whole method beside it,
          since a laptop on the counter has the width to show where you are
          in it. Same state as the phone's below. */}
      <div class="hidden min-h-0 flex-1 flex-col lg:flex">
        <div class="flex shrink-0 items-center gap-3 px-8 pt-5">
          <button
            type="button"
            class="btn-quiet min-h-11 gap-2 pr-4 pl-3 font-semibold"
            onClick={onClose}
          >
            <Icon name="close" class="size-[18px]" />
            Exit cook mode
          </button>
          <span class="min-w-0 flex-1 truncate text-center text-row text-muted">
            {title}
          </span>
          {/* Only once the lock is actually held. */}
          <span
            class={`flex items-center gap-1.5 text-note text-muted ${
              screenAwake ? "" : "invisible"
            }`}
          >
            <Icon name="sun" class="size-[15px]" />
            Screen stays on
          </span>
        </div>

        <div class="flex shrink-0 gap-1.5 px-8 pt-5" aria-hidden="true">
          {steps.map((_, k) => (
            <span
              key={k}
              class={`h-1 flex-1 rounded-full ${k <= n ? "bg-accent" : "bg-line"}`}
            />
          ))}
        </div>

        <div class="mx-auto grid min-h-0 w-full max-w-[75rem] flex-1 grid-cols-[minmax(0,1fr)_360px] gap-14 px-16 py-10">
          <div class="flex min-h-0 flex-col gap-5 overflow-y-auto">
            <span class="text-row font-bold tabular-nums">
              Step {n + 1} of {steps.length}
            </span>
            <p
              class={`max-w-[34ch] font-display leading-[1.3] font-medium tracking-[-0.005em] text-pretty ${
                long ? "text-[1.875rem]" : "text-[2.25rem]"
              }`}
              aria-live="polite"
            >
              {text}
            </p>

            {uses.length > 0 && (
              <div class="flex flex-col gap-2.5">
                <span class="label text-muted">For this step</span>
                <div class="flex flex-wrap gap-1.5">
                  {uses.map((chip) => (
                    <span
                      key={chip}
                      class="inline-flex min-h-[34px] items-center rounded-full border border-line bg-surface px-3 text-row"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showAll}

            <div class="mt-auto flex max-w-[620px] flex-col gap-4">
              <div class="cook-next mt-0 px-4.5 py-4">
                <span class="label text-muted">
                  {last ? "Last step" : `Next · Step ${n + 2}`}
                </span>
                <span class="line-clamp-2 text-lg leading-[1.4] text-muted">
                  {last
                    ? "Plate up. Mark it as made when you're done."
                    : steps[n + 1]}
                </span>
              </div>
              <div class="grid grid-cols-[1fr_2fr] gap-2.5">
                <button
                  type="button"
                  class="btn-quiet h-15 gap-1.5 text-step font-semibold"
                  disabled={n === 0}
                  onClick={prev}
                >
                  <Icon name="chevron-left" class="size-5" stroke={2} />
                  Back
                </button>
                <button
                  type="button"
                  class="btn-primary h-15 gap-1.5 text-step"
                  onClick={next}
                >
                  {last ? (
                    "Done"
                  ) : (
                    <>
                      Next step
                      <Icon name="chevron-right" class="size-5" stroke={2} />
                    </>
                  )}
                </button>
              </div>
              <span class="text-note text-muted">
                Use ← and → to move between steps
              </span>
            </div>
          </div>

          {/* Every step, so you can jump to one. Done ones get a tick and
              go quiet. */}
          <aside class="card flex max-h-full flex-col gap-0.5 self-start overflow-y-auto px-3 py-4">
            <h2 class="label px-2 pb-2 text-muted">All steps</h2>
            {steps.map((step, k) => (
              <button
                key={k}
                type="button"
                aria-current={k === n ? "step" : undefined}
                class={`flex min-h-13 w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors ${
                  k === n
                    ? "bg-accent-soft"
                    : k < n
                      ? "text-muted hover:bg-canvas"
                      : "hover:bg-canvas"
                }`}
                onClick={() => onStep(k)}
              >
                <span
                  class={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    k === n
                      ? "bg-accent text-on-ink"
                      : "border border-line bg-surface"
                  }`}
                >
                  {k < n ? (
                    <Icon name="check" class="size-4" stroke={2} />
                  ) : (
                    k + 1
                  )}
                </span>
                <span class="line-clamp-2 min-w-0 flex-1 pt-1 text-sm leading-[1.4]">
                  {step}
                </span>
              </button>
            ))}
          </aside>
        </div>
      </div>

      <div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col lg:hidden">
        <div class="flex shrink-0 items-center gap-2 px-3.5 pt-3.5">
          <button
            type="button"
            class="icon-btn-round"
            aria-label="Leave cook mode"
            onClick={onClose}
          >
            <Icon name="close" class="size-5" />
          </button>
          <span class="flex-1 text-center text-sm font-semibold tabular-nums">
            Step {n + 1} of {steps.length}
          </span>
          {/* As wide as the close button, so the count stays in the middle. */}
          <span class="size-11 shrink-0" aria-hidden="true" />
        </div>

        {/* One segment per step, so how far through you are reads without
            doing sums. */}
        <div class="flex shrink-0 gap-1 px-5 pt-4" aria-hidden="true">
          {steps.map((_, k) => (
            <span
              key={k}
              class={`h-1 flex-1 rounded-full ${k <= n ? "bg-accent" : "bg-line"}`}
            />
          ))}
        </div>

        <div
          ref={body}
          class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 pt-9 pb-1"
        >
          {/* The notes have no sub-sections the app can see, so the label is
              the recipe. It's what you'd want to know glancing over anyway. */}
          <span class="label truncate text-accent-ink">{title}</span>
          <p
            class={`font-display leading-[1.3] font-medium tracking-[-0.005em] text-pretty ${
              long ? "text-2xl" : "text-[1.75rem]"
            }`}
            aria-live="polite"
          >
            {text}
          </p>

          {uses.length > 0 && (
            <div class="mt-1 flex flex-col gap-2.5">
              <span class="label text-muted">For this step</span>
              <div class="flex flex-wrap gap-1.5">
                {uses.map((chip) => (
                  <span
                    key={chip}
                    class="inline-flex min-h-[34px] items-center rounded-full border border-line bg-surface px-3 text-row"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showAll}

          <div class="cook-next mb-1">
            <span class="label text-muted">
              {last ? "Last step" : `Next · Step ${n + 2}`}
            </span>
            <span class="line-clamp-2 text-step leading-[1.4] text-muted">
              {last
                ? "Plate up. Mark it as made when you're done."
                : steps[n + 1]}
            </span>
          </div>
        </div>

        <div class="flex shrink-0 flex-col gap-3 px-4 pt-3 pb-4">
          {/* Only once the lock is actually held. Saying the screen stays on
              where it doesn't would be worse than saying nothing. */}
          {screenAwake && (
            <p class="flex items-center justify-center gap-1.5 text-note text-muted">
              <Icon name="sun" class="size-[15px]" />
              Screen stays on
            </p>
          )}
          {/* Next is the bigger target. It's the one you hit forty times; back
              is for the step you skimmed. */}
          <div class="grid grid-cols-[1fr_2fr] gap-2.5">
            <button
              type="button"
              class="btn-quiet h-16 gap-1.5 text-step font-semibold"
              disabled={n === 0}
              onClick={prev}
            >
              <Icon name="chevron-left" class="size-5" stroke={2} />
              Back
            </button>
            <button
              type="button"
              class="btn-primary h-16 gap-1.5 text-step"
              onClick={next}
            >
              {last ? (
                "Done"
              ) : (
                <>
                  Next step
                  <Icon name="chevron-right" class="size-5" stroke={2} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {listOpen && (
        <Sheet title="Ingredients" onClose={() => setListOpen(false)}>
          <ul class="card divide-y divide-line overflow-hidden">
            {ingredients.map((line, i) => (
              <li key={`${line}-${i}`} class="px-4 py-3 text-row leading-snug">
                {line}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
