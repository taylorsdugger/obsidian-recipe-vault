import { useEffect, useState } from "preact/hooks";

import { api, LinkOff, type PublicRecipe } from "../api";
import { CookMode } from "../components/cook-mode";
import { Icon } from "../components/icon";
import { AppIcon, PotMark } from "../components/logo";
import { spaced, sourceHost } from "../format";
import { back, navigate, replace } from "../router";
import { useWakeLock } from "../wake-lock";

type Tab = "ingredients" | "steps";

/**
 * A recipe someone was sent a link to. No sign-in, no tabs, nothing about the
 * household: the recipe, a checklist to tick as you go, and cook mode.
 *
 * `/s/<token>/cook` opens cook mode over it the same way the recipe screen
 * does, so the phone's back gesture closes cook mode rather than the page.
 */
export function Shared({
  token,
  cooking,
}: {
  token: string;
  cooking: boolean;
}) {
  const [recipe, setRecipe] = useState<PublicRecipe | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ingredients");
  const [broken, setBroken] = useState(false);
  const [cookStep, setCookStep] = useState(0);
  const screenAwake = useWakeLock();

  useEffect(() => {
    api
      .shared(token)
      .then((res) => {
        setRecipe(res.recipe);
        document.title = res.recipe.title;
      })
      .catch((err: unknown) => {
        if (err instanceof LinkOff) setOff(true);
        else setError(err instanceof Error ? err.message : String(err));
      });
  }, [token]);

  if (off) {
    return (
      <div class="flex h-full flex-col items-center justify-center gap-3.5 px-10 text-center">
        <span class="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Icon name="link-off" class="size-[26px]" />
        </span>
        <h1 class="font-display text-[1.75rem] leading-[1.15] font-medium">
          This link is no longer active
        </h1>
        <p class="max-w-sm text-row leading-normal text-muted">
          The person who shared this recipe turned the link off. Ask them for a
          new one.
        </p>
      </div>
    );
  }
  if (error) {
    return <p class="screen pt-8 text-sm text-danger">{error}</p>;
  }
  if (!recipe) return null;

  const home = `/s/${token}`;
  const startCooking = () => navigate(`${home}/cook`);
  const photo = recipe.photoUrl && !broken ? recipe.photoUrl : null;
  const host = recipe.sourceUrl ? sourceHost(recipe.sourceUrl) : null;

  const meta = (
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-muted lg:gap-x-4">
      {spaced(recipe.mealType) && <span>{spaced(recipe.mealType)}</span>}
      {recipe.cookTime && (
        <span class="flex items-center gap-1.5">
          <Icon name="clock" class="size-[15px]" />
          {recipe.cookTime}
        </span>
      )}
      {recipe.author && <span>By {recipe.author}</span>}
      {host && (
        <a
          class="hidden font-semibold text-accent-ink lg:inline"
          href={recipe.sourceUrl!}
          target="_blank"
          rel="noreferrer"
        >
          {host}
        </a>
      )}
    </div>
  );

  // Ticked here means "got it out", and nothing is sent anywhere. Unchecked
  // state, so it resets on a reload, which is fine for one evening's cooking.
  const ingredientList = (row: string, text: string) => (
    <ul class="-mx-2 flex flex-col">
      {recipe.ingredients.map((line, i) => (
        <li key={`${line}-${i}`}>
          <label class={`check-row ${row}`}>
            <input type="checkbox" class="check appearance-none" />
            <span class={`leading-[1.35] ${text}`}>{line}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  const stepList = (gap: string) => (
    <ol class={`flex flex-col ${gap}`}>
      {recipe.steps.map((step, i) => (
        <li key={`${step}-${i}`} class="flex gap-3.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-row font-bold text-accent-ink">
            {i + 1}
          </span>
          <span class="pt-1 text-step leading-normal">{step}</span>
        </li>
      ))}
    </ol>
  );

  const notes = recipe.notes.length > 0 && (
    <section class="mt-2 flex flex-col gap-2">
      <h2 class="label text-muted">Notes</h2>
      {recipe.notes.map((note, i) => (
        <p key={i} class="text-base leading-normal">
          {note}
        </p>
      ))}
    </section>
  );

  const photoBox = (box: string) =>
    photo ? (
      <img
        class={`object-cover ${box}`}
        src={photo}
        alt=""
        onError={() => setBroken(true)}
      />
    ) : (
      <div
        class={`grid place-items-center bg-linear-to-b from-surface to-canvas ${box}`}
      >
        <PotMark class="size-14 text-faint/45" />
      </div>
    );

  return (
    <>
      {/* Desktop: a header with the two things you'd do, and the recipe laid
          out the way the signed-in screen does it. */}
      <div class="hidden min-h-full flex-col lg:flex">
        <header class="flex h-[72px] shrink-0 items-center gap-4 border-b border-line bg-surface px-10">
          <span class="flex flex-1 items-center gap-2.5 text-sm text-muted">
            <AppIcon class="size-[22px]" />
            Shared from
            <span class="font-display text-lg font-semibold text-ink">
              Recipe Vault
            </span>
          </span>
          {recipe.sourceUrl && (
            <a
              class="btn-quiet min-h-[46px] px-[18px] text-row font-semibold"
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View original
              <Icon name="external" class="size-4" stroke={2} />
            </a>
          )}
          {recipe.steps.length > 0 && (
            <button
              type="button"
              class="btn-primary min-h-[46px] text-row"
              onClick={startCooking}
            >
              <Icon name="flame" class="size-[18px]" />
              Start cooking
            </button>
          )}
        </header>

        <div class="mx-auto grid w-full max-w-5xl grid-cols-[380px_minmax(0,1fr)] items-start gap-12 px-8 pt-8 pb-12">
          <aside class="flex flex-col gap-3.5">
            {photoBox("h-60 w-full rounded-3xl")}
            <div class="flex items-baseline justify-between pt-1">
              <h2 class="font-display text-2xl font-medium">Ingredients</h2>
            </div>
            {ingredientList("min-h-[46px] py-1", "text-row")}
          </aside>
          <div class="flex max-w-[62ch] flex-col gap-3.5">
            <h1 class="font-display text-[2.75rem] leading-[1.06] font-medium tracking-[-0.01em] text-balance">
              {recipe.title}
            </h1>
            {meta}
            <h2 class="mt-2.5 font-display text-2xl font-medium">Steps</h2>
            {stepList("gap-3.5")}
            {notes}
          </div>
        </div>
      </div>

      {/* Phone: one half at a time behind the switch, like the recipe screen. */}
      <div class="mx-auto max-w-2xl lg:hidden">
        <div class="flex h-12 items-center gap-2 px-5 pt-[env(safe-area-inset-top)] text-note text-muted">
          <AppIcon class="size-4" />
          Shared from Recipe Vault
        </div>
        {photoBox(
          `w-full sm:rounded-t-2xl ${tab === "steps" ? "h-30" : "h-50"}`,
        )}
        <div class="relative -mt-7 flex flex-col gap-3 rounded-t-[28px] bg-canvas px-5 pt-6 pb-36">
          <h1 class="font-display text-[1.9375rem] leading-[1.1] font-medium tracking-[-0.01em] text-balance">
            {recipe.title}
          </h1>
          {meta}
          {recipe.sourceUrl && (
            <a
              class="-my-1.5 flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-accent-ink"
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View original on {host}
              <Icon name="external" class="size-[15px]" stroke={2} />
            </a>
          )}
          {tab === "ingredients" ? (
            ingredientList("min-h-[52px] py-1", "text-base")
          ) : (
            <>
              {stepList("gap-4")}
              {notes}
            </>
          )}
        </div>

        {/* No sidebar on this page, so the bar runs the full width at `md`. */}
        <div class="action-bar action-bar-pushed md:left-0">
          <div class="mx-auto flex w-full max-w-2xl items-center gap-2">
            <div
              role="tablist"
              aria-label="Recipe sections"
              class="segmented min-w-0 flex-1"
            >
              {(
                [
                  ["ingredients", "Ingredients"],
                  ["steps", "Steps"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  class={tab === key ? "pill-on" : "pill"}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {recipe.steps.length > 0 && (
              <button
                type="button"
                class="btn-primary shrink-0"
                onClick={startCooking}
              >
                <Icon name="flame" class="size-[18px]" />
                Cook
              </button>
            )}
          </div>
        </div>
      </div>

      {cooking && recipe.steps.length > 0 && (
        <CookMode
          title={recipe.title}
          steps={recipe.steps}
          ingredients={recipe.ingredients}
          step={cookStep}
          screenAwake={screenAwake}
          onStep={setCookStep}
          onClose={() => back(home)}
          onDone={() => {
            setCookStep(0);
            replace(home);
          }}
        />
      )}
    </>
  );
}
