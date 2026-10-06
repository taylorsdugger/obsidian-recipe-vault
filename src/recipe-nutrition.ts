import { App, Modal, Platform, setIcon } from "obsidian";
import {
  nutritionView,
  sourceHost,
  type Nutrition,
  type NutritionView,
} from "@recipe-vault/core";

/** What a strip needs to know about its recipe besides the numbers. */
export interface NutritionContext {
  app: App;
  nutrition: Nutrition;
  /** The yield as written, for "serves 4" and the whole-recipe total. */
  servings: string;
  /** How big a serving is, from the page: "1 of 12 fritters", or "". */
  servingSize: string;
  /** The scale the recipe's being made at, read when the details open. */
  scale: () => number;
  sourceUrl: string;
}

/**
 * The colors protein, carbs and fat get everywhere: the strip's dots, the
 * bar and the rows. Theme variables, so a theme that retunes its palette
 * retunes these too.
 */
const MACRO_COLOR: Record<string, string> = {
  protein: "var(--color-blue)",
  carbs: "var(--color-orange)",
  fat: "var(--color-green)",
};

const SHORT: Record<string, string> = { protein: "P", carbs: "C", fat: "F" };

/** The one popover that's open, so opening another closes it. */
let openPopover: { button: HTMLElement; close: () => void } | null = null;

/**
 * Calories and the three macros on one line, under the At a Glance callout.
 * Tapping it opens the details: a popover anchored to it on a desktop or
 * tablet, a bottom sheet on a phone. Long labels or short ones by the pane's
 * width, which the css decides.
 */
export function buildNutritionStrip(ctx: NutritionContext): HTMLElement {
  const view = nutritionView(
    ctx.nutrition,
    ctx.servings,
    1,
    false,
    ctx.servingSize,
  );
  const button = createEl("button", {
    cls: "recipe-nutrition",
    attr: {
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    },
  });

  if (view.calories) {
    const cal = button.createSpan({ cls: "recipe-nutrition-cal" });
    cal.createEl("b", { text: view.calories });
    cal.appendText(" cal");
  }
  for (const row of view.rows.filter((r) => r.isMacro)) {
    const macro = button.createSpan({ cls: "recipe-nutrition-macro" });
    dot(macro, row.key);
    const long = macro.createSpan({ cls: "recipe-nutrition-long" });
    long.createEl("b", { text: row.amount });
    long.appendText(` ${row.label.toLowerCase()}`);
    const short = macro.createSpan({ cls: "recipe-nutrition-short" });
    short.createEl("b", { text: row.amount.replace(" ", "") });
    short.appendText(` ${SHORT[row.key]}`);
  }
  // Only fiber, sugar or sodium: nothing for the line, so it just says what
  // it opens.
  if (!button.hasChildNodes()) {
    button.createSpan({ cls: "recipe-nutrition-cal", text: "Nutrition" });
  }
  // One piece with the chevron, so a wrap never leaves it on a line alone.
  const end = button.createSpan({ cls: "recipe-nutrition-end" });
  end.createSpan({
    cls: "recipe-nutrition-per",
    text: view.perLabel,
  });
  setIcon(
    end.createSpan({ cls: "recipe-nutrition-chevron mod-down" }),
    "chevron-down",
  );
  setIcon(
    end.createSpan({ cls: "recipe-nutrition-chevron mod-right" }),
    "chevron-right",
  );

  button.addEventListener("click", () => {
    if (Platform.isPhone) {
      new NutritionSheet(ctx).open();
      return;
    }
    if (openPopover?.button === button) {
      openPopover.close();
      return;
    }
    new NutritionPopover(button, ctx).open();
  });
  return button;
}

function dot(parent: HTMLElement, key: string): void {
  const el = parent.createSpan({
    cls: "recipe-nutrition-dot",
    attr: { "aria-hidden": "true" },
  });
  if (MACRO_COLOR[key]) el.style.setProperty("--dot-color", MACRO_COLOR[key]);
}

/**
 * The details, the same in the popover and the sheet: the total, the
 * calorie split as a bar, every nutrient with its share, and where the
 * numbers came from. Redraws itself when the switch flips.
 */
function renderDetails(
  parent: HTMLElement,
  ctx: NutritionContext,
  opts: { title: boolean },
): void {
  let whole = false;
  const draw = () => {
    const view = nutritionView(
      ctx.nutrition,
      ctx.servings,
      ctx.scale(),
      whole,
      ctx.servingSize,
    );
    parent.empty();
    if (opts.title || view.canShowWhole) {
      const head = parent.createDiv({ cls: "recipe-nutrition-head" });
      if (opts.title) {
        head.createSpan({ cls: "recipe-nutrition-title", text: "Nutrition" });
      }
      if (view.canShowWhole) {
        segmented(head, whole, (next) => {
          whole = next;
          draw();
        });
      }
    }
    if (view.calories) {
      const total = parent.createDiv({ cls: "recipe-nutrition-total" });
      total.createSpan({
        cls: "recipe-nutrition-total-value",
        text: view.calories,
      });
      total.createSpan({
        cls: "recipe-nutrition-total-label",
        text: `calories ${view.caption}`,
      });
    }
    if (view.servingNote) {
      parent.createDiv({
        cls: "recipe-nutrition-note",
        text: view.servingNote,
      });
    }
    drawBar(parent, view);
    const rows = parent.createDiv({ cls: "recipe-nutrition-rows" });
    for (const row of view.rows) {
      const el = rows.createDiv({ cls: "recipe-nutrition-row" });
      if (row.isMacro) dot(el, row.key);
      else el.createSpan({ cls: "recipe-nutrition-dot mod-empty" });
      el.createSpan({ cls: "recipe-nutrition-row-label", text: row.label });
      el.createSpan({ cls: "recipe-nutrition-row-amount", text: row.amount });
      el.createSpan({
        cls: "recipe-nutrition-row-percent",
        text: row.percent === null ? "" : `${row.percent}%`,
      });
    }
    const foot = [
      sourceHost(ctx.sourceUrl) ? `From ${sourceHost(ctx.sourceUrl)}` : "",
      view.split ? "% of calories" : "",
    ].filter(Boolean);
    if (foot.length > 0) {
      parent.createDiv({
        cls: "recipe-nutrition-foot",
        text: foot.join(" · "),
      });
    }
  };
  draw();
}

function drawBar(parent: HTMLElement, view: NutritionView): void {
  if (!view.split) return;
  const bar = parent.createDiv({
    cls: "recipe-nutrition-bar",
    attr: { role: "img", "aria-label": view.splitLabel },
  });
  for (const macro of view.split) {
    if (macro.percent === 0) continue;
    const part = bar.createSpan();
    part.style.flexGrow = String(macro.percent);
    part.style.setProperty("--dot-color", MACRO_COLOR[macro.key]);
  }
}

/** Per serving / Whole recipe. */
function segmented(
  parent: HTMLElement,
  whole: boolean,
  onChange: (whole: boolean) => void,
): void {
  const track = parent.createDiv({
    cls: "recipe-nutrition-switch",
    attr: { role: "group", "aria-label": "Show nutrition for" },
  });
  for (const [value, label] of [
    [false, "Per serving"],
    [true, "Whole recipe"],
  ] as const) {
    const button = track.createEl("button", {
      text: label,
      attr: { type: "button", "aria-pressed": String(whole === value) },
    });
    button.addEventListener("click", () => {
      if (whole !== value) onChange(value);
    });
  }
}

/**
 * Anchored under the strip. Mounted on the body with Obsidian's own
 * `.popover` look, the way its menus and link previews are, so nothing in
 * the note's layout can clip it, and kept under the strip as the note
 * scrolls. Clicking outside or Escape closes it.
 */
class NutritionPopover {
  private readonly el: HTMLElement;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly button: HTMLElement,
    private readonly ctx: NutritionContext,
  ) {
    this.el = createDiv({
      cls: "popover recipe-nutrition-popover recipe-nutrition-details",
      attr: { role: "dialog", "aria-label": "Nutrition" },
    });
  }

  open(): void {
    openPopover?.close();
    openPopover = { button: this.button, close: () => this.close() };
    const doc = this.button.doc;
    renderDetails(this.el, this.ctx, { title: true });
    doc.body.appendChild(this.el);
    this.button.setAttribute("aria-expanded", "true");
    this.place();

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (this.el.contains(target) || this.button.contains(target)))
        return;
      this.close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.close();
      this.button.focus();
    };
    const onMove = () => this.place();
    doc.addEventListener("pointerdown", onPointer, true);
    doc.addEventListener("keydown", onKey, true);
    // Capture, so a scroll anywhere (the note, the rail) moves it along.
    doc.addEventListener("scroll", onMove, true);
    this.button.win.addEventListener("resize", onMove);
    this.cleanup.push(
      () => doc.removeEventListener("pointerdown", onPointer, true),
      () => doc.removeEventListener("keydown", onKey, true),
      () => doc.removeEventListener("scroll", onMove, true),
      () => this.button.win.removeEventListener("resize", onMove),
    );
  }

  close(): void {
    this.cleanup.splice(0).forEach((fn) => fn());
    this.el.remove();
    this.button.setAttribute("aria-expanded", "false");
    if (openPopover?.button === this.button) openPopover = null;
  }

  /**
   * Under the strip, lined up with its left edge, kept inside the window.
   * Above it when there's no room below. Gone with the strip when reading
   * view drops that part of the note.
   */
  private place(): void {
    if (!this.button.isConnected) {
      this.close();
      return;
    }
    const gap = 6;
    const margin = 8;
    const win = this.button.win;
    const rect = this.button.getBoundingClientRect();
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    const left = Math.max(
      margin,
      Math.min(rect.left, win.innerWidth - width - margin),
    );
    const below = rect.bottom + gap;
    const top =
      below + height > win.innerHeight - margin && rect.top - gap - height > 0
        ? rect.top - gap - height
        : below;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }
}

/**
 * The phone's version: a sheet up from the bottom, where the thumb is.
 * Obsidian's own confirmation dialogs sit there on a phone, and this borrows
 * how they do it.
 */
class NutritionSheet extends Modal {
  constructor(private readonly ctx: NutritionContext) {
    super(ctx.app);
  }

  onOpen(): void {
    this.containerEl.addClass("recipe-nutrition-sheet-container");
    this.modalEl.addClass("recipe-nutrition-sheet");
    this.setTitle("Nutrition");
    renderDetails(
      this.contentEl.createDiv({ cls: "recipe-nutrition-details" }),
      this.ctx,
      { title: false },
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
