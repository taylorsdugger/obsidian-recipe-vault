// Deep imports on purpose: the core barrel pulls in cheerio and handlebars,
// which the parser and the renderer need on the Worker but the phone does not.
import { parseRecipeSections } from "@recipe-vault/core/note/sections";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";
import {
  readRecipeFile,
  scaleRecipeIngredients,
} from "@recipe-vault/core/note/recipe-file";
import { scaleLabel } from "@recipe-vault/core/scale";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { api, type PublicRecipe, type RecipeDetail } from "../api";
import { CookMode } from "../components/cook-mode";
import { Icon } from "../components/icon";
import { PhotoViewer } from "../components/photo-viewer";
import { PotMark } from "../components/logo";
import { ScaleControl } from "../components/scale-control";
import { ShareSheet } from "../components/share-sheet";
import { Sheet } from "../components/sheet";
import {
  NutritionDetails,
  NutritionPopover,
  NutritionStrip,
} from "../components/nutrition";
import { madeToday, shortDate, spaced } from "../format";
import { storedRecipeLayout } from "../recipe-layout";
import { back, navigate, replace } from "../router";
import { scrollContainer } from "../scroll";
import { useWakeLock } from "../wake-lock";

type Tab = "ingredients" | "steps";

/** Says nothing you need to act on, so it clears itself. */
const MARKED_MADE = "Marked as made.";

/**
 * One recipe. The note is the source of truth, so the sections rendered here
 * are parsed out of the markdown with the same core functions the plugin uses
 * for its note actions - no second copy of the note's shape.
 *
 * A pushed screen: on a phone the tab bar goes and a dock takes its place,
 * holding the Ingredients / Steps switch and the one thing each half is for.
 * Ticking ingredients sends them to the list; reading steps leads to cook
 * mode, which `cooking` draws over the top of this screen.
 */
export function Recipe({ id, cooking }: { id: string; cooking: boolean }) {
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [broken, setBroken] = useState(false);
  const [tab, setTab] = useState<Tab>("ingredients");
  /**
   * Kitchen or Classic on a phone, from the settings screen. Read once when
   * the recipe opens: changing it means going to settings, which unmounts
   * this screen anyway.
   */
  const [layout] = useState(storedRecipeLayout);
  const kitchen = layout === "kitchen";
  const [sharing, setSharing] = useState(false);
  /** The phone's nutrition sheet. The desktop's popover keeps its own. */
  const [showNutrition, setShowNutrition] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Where cook mode is up to. Kept here so closing it and coming back resumes. */
  const [cookStep, setCookStep] = useState(0);
  /** Cook mode just finished, so ask whether to count it. */
  const [offerMade, setOfferMade] = useState(false);
  /**
   * How much of the recipe to make: 2 for a double batch. Here rather than in
   * the note, since it's about tonight, not the recipe. Cook mode and the
   * list both use it.
   */
  const [scale, setScale] = useState(1);

  // Nobody taps the phone between "brown the onions" and "add the stock", and
  // a locked screen with wet hands is the whole reason this screen exists.
  // Held for as long as the recipe is open - cook mode included, since it's
  // drawn over this screen rather than replacing it - and dropped on the way
  // out. The hook asks again every time the page comes back into view.
  const screenAwake = useWakeLock();

  // Where each half was scrolled to when it was left, and the top of the
  // half that's showing. Switching used to jump to the top of the screen,
  // which lost your place every time you checked a step against the list.
  const tabScroll = useRef<Partial<Record<Tab, number>>>({});
  const tabStart = useRef<HTMLDivElement>(null);
  const switched = useRef(false);

  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    const scroller = scrollContainer();
    if (!scroller) return;
    const saved = tabScroll.current[tab];
    if (saved !== undefined) {
      scroller.scrollTop = saved;
      return;
    }
    // The first visit lands on the start of this half, unless you're still
    // further up than that, looking at the photo.
    const start = tabStart.current;
    if (!start) return;
    const top =
      start.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      12;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollTop, top));
  }, [tab]);

  useEffect(() => {
    setScale(1);
    api
      .recipe(id)
      .then((res) => setRecipe(res.recipe))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [id]);

  // Only clears if it's still the message showing, so an error that replaced
  // it in the meantime stays put.
  useEffect(() => {
    if (status !== MARKED_MADE) return;
    const timer = setTimeout(
      () => setStatus((current) => (current === MARKED_MADE ? null : current)),
      2500,
    );
    return () => clearTimeout(timer);
  }, [status]);

  // A .cook file has no sections to find. Its ingredients come from the
  // steps' markup, and its steps read back as plain text.
  const cooklang = useMemo(
    () =>
      recipe?.vaultKey?.toLowerCase().endsWith(".cook")
        ? readRecipeFile(recipe.vaultKey, recipe.markdown)
        : null,
    [recipe],
  );
  const sections = useMemo(
    () =>
      cooklang
        ? {
            recipeIngredient: cooklang.ingredients,
            recipeInstructions: cooklang.instructions,
          }
        : recipe
          ? parseRecipeSections(recipe.markdown)
          : null,
    [recipe, cooklang],
  );
  const frontmatter = useMemo(
    () => (recipe ? readFrontmatter(recipe.markdown) : {}),
    [recipe],
  );
  // Per serving, from a note's `calories`, `protein` and the rest, or the
  // same names in a .cook file's front matter, with how big a serving is.
  const { nutrition, servingSize } = useMemo(() => {
    const summary = recipe
      ? readRecipeFile(recipe.vaultKey ?? "recipe.md", recipe.markdown)
      : null;
    return {
      nutrition: summary?.nutrition ?? null,
      servingSize: summary?.servingSize ?? "",
    };
  }, [recipe]);
  const notes = useMemo(
    () => cooklang?.notes ?? notesFromMarkdown(recipe?.markdown ?? ""),
    [recipe, cooklang],
  );
  // The lines as they'll be cooked. A .cook file scales by its markup, so an
  // amount fixed with `=` stays put; a note scales the amount at the front.
  const scaledIngredients = useMemo(
    () =>
      recipe && scale !== 1
        ? scaleRecipeIngredients(
            recipe.vaultKey ?? "recipe.md",
            recipe.markdown,
            scale,
          )
        : null,
    [recipe, scale],
  );

  if (error) {
    // No tab bar on this screen, so even the error needs a way out.
    return (
      <div class="screen space-y-3 pt-[calc(1rem+env(safe-area-inset-top))]">
        <button
          type="button"
          class="icon-btn-round"
          aria-label="Back"
          onClick={() => back("/recipes")}
        >
          <Icon name="chevron-left" stroke={2} />
        </button>
        <p class="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!recipe) return null;

  const written = sections?.recipeIngredient ?? [];
  // Same length and order as written, so a tick stays on its line.
  const ingredients =
    scaledIngredients?.length === written.length ? scaledIngredients : written;
  const instructions = sections?.recipeInstructions ?? [];
  const servings = cooklang
    ? cooklang.servings
    : (
        frontmatter.servings ||
        frontmatter.yield ||
        frontmatter.serves ||
        ""
      ).trim();

  // What the link and the PDF show. The same fields the public endpoint
  // builds, so the PDF printed here matches the page someone else opens.
  const publicView: PublicRecipe = {
    title: recipe.title,
    mealType: recipe.mealType,
    cookTime: recipe.cookTime,
    author: recipe.author,
    sourceUrl: recipe.sourceUrl,
    photoUrl: recipe.photoUrl,
    ingredients: written,
    steps: instructions,
    notes,
  };
  const alreadyMade = madeToday(recipe.lastMade);

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

  const showTab = (next: Tab) => {
    if (next === tab) return;
    tabScroll.current[tab] = scrollContainer()?.scrollTop ?? 0;
    switched.current = true;
    setTab(next);
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
      setRecipe({
        ...recipe,
        timesMade: res.timesMade,
        lastMade: res.lastMade,
      });
      setStatus(MARKED_MADE);
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

  const deleteRecipe = async () => {
    setBusy(true);
    try {
      await api.deleteRecipe(recipe.id);
      navigate("/recipes");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const startCooking = () => navigate(`/recipes/${recipe.id}/cook`);

  // Done swaps the cook entry for the recipe rather than going back. Cook
  // mode started from home would otherwise land back on home, and the "mark
  // it made?" question has to be asked here, where the recipe is.
  const finishCooking = () => {
    setCookStep(0);
    setOfferMade(!alreadyMade);
    replace(`/recipes/${recipe.id}`);
  };

  if (editing) {
    return (
      <div class="mx-auto flex h-full w-full max-w-2xl flex-col gap-3 p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p class="text-sm text-muted">
          The note itself. Saving writes it back to the vault.
        </p>
        <textarea
          class="min-h-0 flex-1 rounded-2xl border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        />
        {status && <p class="text-sm text-muted">{status}</p>}
        <div class="flex gap-2">
          <button
            type="button"
            class="btn-primary flex-1"
            disabled={busy}
            onClick={() => void saveEdit()}
          >
            Save
          </button>
          <button
            type="button"
            class="btn-quiet min-h-[54px] px-5"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /*
   * The lists both layouts draw: the phone's, one half at a time behind the
   * switch, and the desktop's, side by side.
   */
  const ingredientList = (spacing: string, row: string) => (
    <ul class={`-mx-2 flex flex-col ${spacing}`}>
      {ingredients.map((line, i) => (
        <li key={`${line}-${i}`}>
          {/* The whole row is the hit area, not the box. Ticked means
              "send to the list", not "done", so no strike-through. */}
          <label class={`check-row ${row}`}>
            <input
              type="checkbox"
              class="check appearance-none"
              checked={checked.has(i)}
              onChange={() => toggle(i)}
            />
            <span class="text-base leading-[1.35] lg:text-row">{line}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  const scaleControl = (cls: string) => (
    <ScaleControl
      factor={scale}
      servings={servings}
      onChange={setScale}
      class={cls}
    />
  );

  const stepList = (spacing: string) => (
    <ol class={`flex flex-col ${spacing}`}>
      {instructions.map((step, i) => (
        <li key={`${step}-${i}`} class="flex gap-3.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-row font-bold text-accent-ink">
            {i + 1}
          </span>
          <span class="pt-1 text-step leading-[1.55]">{step}</span>
        </li>
      ))}
    </ol>
  );

  const notesSection = notes.length > 0 && (
    <section class="mt-8 space-y-2">
      <h2 class="text-lg font-semibold">Notes</h2>
      <ul class="card space-y-2 p-4 text-row leading-relaxed">
        {notes.map((note, i) => (
          <li key={`${note}-${i}`}>{note}</li>
        ))}
      </ul>
    </section>
  );

  const statusLine = status && (
    <div class="flex items-start gap-2 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
      <p class="min-w-0 flex-1">{status}</p>
      <button
        type="button"
        class="-my-1 -mr-1 shrink-0 p-1"
        aria-label="Dismiss"
        onClick={() => setStatus(null)}
      >
        <Icon name="close" class="size-4" />
      </button>
    </div>
  );

  const metaRow = (spacing: string, awake: string) => (
    <div
      class={`flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-muted lg:gap-x-4 ${spacing}`}
    >
      {spaced(recipe.mealType) && <span>{spaced(recipe.mealType)}</span>}
      {recipe.cookTime && (
        <span class="flex items-center gap-1.5">
          <Icon name="clock" class="size-[15px]" />
          {recipe.cookTime}
        </span>
      )}
      {recipe.timesMade > 0 && (
        <span>
          Made {recipe.timesMade}×
          {recipe.lastMade ? `, last ${shortDate(recipe.lastMade)}` : ""}
        </span>
      )}
      {/* Only once the lock is actually held - saying the screen stays
          on where it doesn't would be worse than saying nothing. */}
      {screenAwake && (
        <span class="flex items-center gap-1.5 font-semibold text-accent-ink">
          <Icon name="sun" class="size-[15px]" />
          {awake}
        </span>
      )}
    </div>
  );

  // Few enough that they all fit in the header, so none of them hide behind
  // a menu. Delete still asks first, in its own sheet.
  const headerActions = (button: string) => (
    <>
      <button
        type="button"
        class={button}
        aria-label="Share recipe"
        title="Share"
        onClick={() => setSharing(true)}
      >
        <Icon name="share" stroke={1.9} />
      </button>
      <button
        type="button"
        class={button}
        aria-label="Edit the note"
        title="Edit the note"
        onClick={() => {
          setDraft(recipe.markdown);
          setEditing(true);
        }}
      >
        <Icon name="edit" stroke={1.9} />
      </button>
      {recipe.sourceUrl && (
        <a
          class={button}
          href={recipe.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the source"
          title="Open the source"
        >
          <Icon name="external" stroke={2} />
        </a>
      )}
      <button
        type="button"
        class={button}
        aria-label="Delete recipe"
        title="Delete recipe"
        onClick={() => setConfirmingDelete(true)}
      >
        <Icon name="trash" stroke={1.9} />
      </button>
    </>
  );

  const madeButton = (cls: string) => (
    // Nobody cooks the same thing twice in one day, so once it's been marked
    // the only thing a second tap can be is a double tap.
    <button
      type="button"
      class={cls}
      disabled={busy || alreadyMade}
      onClick={() => void markMade()}
    >
      <Icon name="made" class="size-[18px]" />
      {alreadyMade ? "Made today" : "Made it"}
    </button>
  );

  const publishedLine = frontmatter.created && (
    <p class="mt-8 text-xs text-muted">
      Published {frontmatter.created.slice(0, 10)}
    </p>
  );

  const photo = recipe.photoUrl && !broken ? recipe.photoUrl : null;
  // The steps want the room more than the photo does, so the hero gives up
  // most of its height once you've moved on to them. Classic has no "moved
  // on": the steps are further down the same page.
  const heroHeight = !photo
    ? "h-32"
    : kitchen && tab === "steps"
      ? "h-[150px]"
      : "h-[236px]";

  return (
    // Capped like every other screen. The hero still bleeds to the edges of
    // the column - full window width it was a 1100px letterbox.
    <>
      {/* The desktop's own layout. Nothing to switch between on a screen this
        wide, so the ingredients sit in a column beside the steps, and the
        dock's buttons move up to the top. */}
      <div class="mx-auto hidden w-full max-w-5xl flex-col gap-5 px-8 pt-6 pb-12 lg:flex">
        <div class="flex items-center justify-between gap-4">
          <button
            type="button"
            class="-ml-2 flex h-11 items-center gap-1 px-2 text-row font-semibold text-muted hover:text-ink"
            onClick={() => back("/recipes")}
          >
            <Icon name="chevron-left" class="size-4.5" stroke={2} />
            Recipes
          </button>
          <div class="flex items-center gap-2">
            {headerActions("icon-btn-round")}
            {madeButton("btn-quiet min-h-12 px-5.5 text-row font-semibold")}
            {instructions.length > 0 && (
              <button
                type="button"
                class="btn-primary min-h-12 px-5.5 text-row"
                onClick={startCooking}
              >
                <Icon name="flame" class="size-[18px]" />
                Cook
              </button>
            )}
          </div>
        </div>

        {statusLine}

        <div class="grid grid-cols-[380px_minmax(0,1fr)] items-start gap-12">
          <aside class="flex flex-col gap-3.5">
            {photo ? (
              <button
                type="button"
                class="block h-55 w-full cursor-zoom-in overflow-hidden rounded-3xl"
                aria-label={`View the photo of ${recipe.title}`}
                onClick={() => setZoomed(true)}
              >
                <img
                  class="size-full object-cover"
                  src={photo}
                  alt=""
                  onError={() => setBroken(true)}
                />
              </button>
            ) : (
              <div class="grid h-55 place-items-center rounded-3xl bg-linear-to-b from-surface to-canvas">
                <PotMark class="size-14 text-faint/45" />
              </div>
            )}
            <div class="flex items-center justify-between gap-3 pt-1">
              <h2 class="font-display text-2xl font-medium">Ingredients</h2>
              {ingredients.length > 0 && (
                <button
                  type="button"
                  class="btn-quiet min-h-10 px-3.5 font-semibold"
                  disabled={busy || checked.size === 0}
                  onClick={() => void sendToList()}
                >
                  <Icon name="cart" class="size-4" />
                  {checked.size > 0
                    ? `Add ${checked.size} to list`
                    : "Add to list"}
                </button>
              )}
            </div>
            {ingredients.length === 0 ? (
              <p class="text-sm text-muted">
                {cooklang
                  ? "This recipe has no ingredients marked in its steps."
                  : "This note has no Ingredients section."}
              </p>
            ) : (
              <>
                {scaleControl("self-start")}
                {ingredientList("", "min-h-12 py-1")}
              </>
            )}
          </aside>

          <div class="flex max-w-[62ch] flex-col gap-4">
            <h1 class="font-display text-[2.625rem] leading-[1.08] font-medium tracking-[-0.01em] text-balance">
              {recipe.title}
            </h1>
            {metaRow("", "Screen stays on")}
            {recipe.author && <p class="text-sm text-muted">{recipe.author}</p>}
            {nutrition && (
              <NutritionPopover
                nutrition={nutrition}
                servings={servings}
                servingSize={servingSize}
                scale={scale}
                sourceUrl={recipe.sourceUrl ?? ""}
              />
            )}
            <h2 class="mt-3 font-display text-2xl font-medium">Steps</h2>
            {instructions.length === 0 ? (
              <p class="text-sm text-muted">
                This note has no Instructions section.
              </p>
            ) : (
              stepList("gap-4")
            )}
            {notesSection}
            {publishedLine}
          </div>
        </div>
      </div>

      <div class="mx-auto max-w-2xl lg:hidden">
        {/* A fixed-height hero rather than the photo's own aspect ratio: these
          come from other people's sites and range from square to tall, and a
          tall one used to push everything below the fold. Full-bleed on a
          phone; once the screen is a centred column the square top corners
          read as unfinished against the canvas, so they round. */}
        <div class={`relative overflow-hidden sm:rounded-t-2xl ${heroHeight}`}>
          {photo ? (
            // The crop here is deliberate, so tapping it opens the whole photo.
            <button
              type="button"
              class="block size-full cursor-zoom-in"
              aria-label={`View the photo of ${recipe.title}`}
              onClick={() => setZoomed(true)}
            >
              <img
                class="size-full object-cover"
                src={photo}
                alt=""
                onError={() => setBroken(true)}
              />
            </button>
          ) : (
            <div class="grid size-full place-items-center bg-linear-to-b from-surface to-canvas">
              <PotMark class="size-14 text-faint/45" />
            </div>
          )}

          {/* Clear of the notch: in the installed app the status bar draws
            over the photo. Not in the way of the tap on it either. */}
          <div class="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-3.5 pt-[max(0.875rem,env(safe-area-inset-top))]">
            <button
              type="button"
              class="icon-btn-round pointer-events-auto border-0"
              aria-label="Back"
              onClick={() => back("/recipes")}
            >
              <Icon name="chevron-left" stroke={2} />
            </button>
            <div class="flex gap-2">
              {headerActions("icon-btn-round pointer-events-auto border-0")}
            </div>
          </div>
        </div>

        {/* The content sheet laps over the photo, which hides the crop line and
          gives the title somewhere to sit. The bottom padding clears the dock. */}
        <div class="relative -mt-7 rounded-t-[28px] bg-canvas px-5 pt-6 pb-36">
          <h1 class="font-display text-[1.9375rem] leading-[1.1] font-medium tracking-[-0.01em] text-balance">
            {recipe.title}
          </h1>

          {metaRow("mt-3.5", "Screen on")}
          {recipe.author && (
            <p class="mt-1.5 text-sm text-muted">{recipe.author}</p>
          )}
          {nutrition && (
            <div class="mt-4">
              <NutritionStrip
                nutrition={nutrition}
                servings={servings}
                servingSize={servingSize}
                compact
                open={showNutrition}
                onClick={() => setShowNutrition(true)}
              />
            </div>
          )}
          {/* The dock is already full with the switch and its one button. */}
          {madeButton("btn-quiet mt-4 min-h-10 px-4 font-semibold")}

          {kitchen ? (
            <>
              <div ref={tabStart} />
              {tab === "ingredients" ? (
                ingredients.length === 0 ? (
                  <p class="mt-5 text-sm text-muted">
                    {cooklang
                      ? "This recipe has no ingredients marked in its steps."
                      : "This note has no Ingredients section."}
                  </p>
                ) : (
                  <>
                    {scaleControl("mt-5")}
                    {ingredientList("mt-3", "min-h-[54px] py-1")}
                  </>
                )
              ) : (
                <>
                  {instructions.length === 0 ? (
                    <p class="mt-5 text-sm text-muted">
                      This note has no Instructions section.
                    </p>
                  ) : (
                    stepList("mt-5 gap-[18px]")
                  )}

                  {/* With the steps, since that's where you are when one matters. */}
                  {notesSection}
                </>
              )}
            </>
          ) : (
            // Classic: the whole recipe down one page, the way the plugin's
            // Classic layout reads it.
            <>
              <h2 class="mt-7 font-display text-2xl font-medium">
                Ingredients
              </h2>
              {ingredients.length === 0 ? (
                <p class="mt-3 text-sm text-muted">
                  {cooklang
                    ? "This recipe has no ingredients marked in its steps."
                    : "This note has no Ingredients section."}
                </p>
              ) : (
                <>
                  {scaleControl("mt-3")}
                  {ingredientList("mt-3", "min-h-[54px] py-1")}
                </>
              )}

              <h2 class="mt-9 font-display text-2xl font-medium">Steps</h2>
              {instructions.length === 0 ? (
                <p class="mt-3 text-sm text-muted">
                  This note has no Instructions section.
                </p>
              ) : (
                stepList("mt-4 gap-[18px]")
              )}
              {notesSection}
            </>
          )}
          {publishedLine}
        </div>

        {/* The dock. Where the thumb already is, whichever half is showing and
          however far down it you've scrolled. */}
        <div class="action-bar action-bar-pushed">
          <div class="mx-auto w-full max-w-2xl space-y-2">
            {statusLine}
            {kitchen ? (
              <div class="flex items-center gap-2">
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
                      onClick={() => showTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* On the ingredients, the button sends what's ticked. With
                  nothing ticked there's nothing to send, so it offers the
                  other thing you came for. */}
                {tab === "ingredients" && checked.size > 0 ? (
                  <button
                    type="button"
                    class="btn-primary shrink-0"
                    disabled={busy}
                    aria-label={`Add ${checked.size} to the list`}
                    onClick={() => void sendToList()}
                  >
                    <Icon name="cart" class="size-[18px]" />
                    Add {checked.size}
                  </button>
                ) : (
                  instructions.length > 0 && (
                    <button
                      type="button"
                      class="btn-primary shrink-0"
                      onClick={startCooking}
                    >
                      <Icon name="flame" class="size-[18px]" />
                      Cook
                    </button>
                  )
                )}
              </div>
            ) : (
              // Classic has no halves to switch between, so the dock is just
              // the two things to do: send what's ticked, and cook.
              (checked.size > 0 || instructions.length > 0) && (
                <div class="flex items-center gap-2">
                  {checked.size > 0 && (
                    <button
                      type="button"
                      class="btn-primary flex-1"
                      disabled={busy}
                      onClick={() => void sendToList()}
                    >
                      <Icon name="cart" class="size-[18px]" />
                      Add {checked.size} to list
                    </button>
                  )}
                  {instructions.length > 0 && (
                    <button
                      type="button"
                      class={
                        checked.size > 0
                          ? "btn-quiet min-h-[54px] shrink-0 px-5 text-base font-semibold"
                          : "btn-primary flex-1"
                      }
                      onClick={startCooking}
                    >
                      <Icon name="flame" class="size-[18px]" />
                      Cook
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Overlays, outside both layouts so either one can open them. */}
      {/* Asked in a sheet rather than with `confirm()`: a system dialog
          looks out of place in a standalone PWA, and this removes the note
          from the vault too, so the warning needs the room to say so. */}
      {confirmingDelete && (
        <Sheet
          title="Delete recipe"
          onClose={() => setConfirmingDelete(false)}
          footer={
            <div class="flex gap-2">
              <button
                type="button"
                class="btn-primary flex-1"
                disabled={busy}
                onClick={() => void deleteRecipe()}
              >
                Delete
              </button>
              <button
                type="button"
                class="btn-quiet min-h-[54px] px-5"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            </div>
          }
        >
          <p class="text-row text-muted">
            Delete “{recipe.title}”? This deletes the note from the vault as
            well.
          </p>
        </Sheet>
      )}

      {sharing && (
        <ShareSheet
          id={recipe.id}
          recipe={publicView}
          onClose={() => setSharing(false)}
        />
      )}

      {offerMade && (
        <Sheet
          title="All done"
          onClose={() => setOfferMade(false)}
          footer={
            <div class="flex gap-2">
              <button
                type="button"
                class="btn-primary flex-1"
                disabled={busy}
                onClick={() => {
                  setOfferMade(false);
                  void markMade();
                }}
              >
                Mark made
              </button>
              <button
                type="button"
                class="btn-quiet min-h-[54px] px-5"
                onClick={() => setOfferMade(false)}
              >
                Not now
              </button>
            </div>
          }
        >
          <p class="text-row text-muted">
            Count this as a time you made {recipe.title}? It's what the
            gallery's Most made sort goes by.
          </p>
        </Sheet>
      )}

      {showNutrition && nutrition && (
        <Sheet title="Nutrition" onClose={() => setShowNutrition(false)}>
          <NutritionDetails
            nutrition={nutrition}
            servings={servings}
            servingSize={servingSize}
            scale={scale}
            sourceUrl={recipe.sourceUrl ?? ""}
            title={false}
          />
        </Sheet>
      )}

      {zoomed && photo && (
        <PhotoViewer
          src={photo}
          alt={recipe.title}
          onClose={() => setZoomed(false)}
        />
      )}

      {cooking && instructions.length > 0 && (
        <CookMode
          title={
            scale === 1
              ? recipe.title
              : `${recipe.title} · ${scaleLabel(scale)}`
          }
          steps={instructions}
          ingredients={ingredients}
          step={cookStep}
          screenAwake={screenAwake}
          onStep={setCookStep}
          onClose={() => back(`/recipes/${recipe.id}`)}
          onDone={finishCooking}
        />
      )}
    </>
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
