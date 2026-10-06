import {
  Component,
  MarkdownRenderer,
  MarkdownView,
  TFile,
  setIcon,
} from "obsidian";
import {
  scaleIngredientLine,
  scaleLabel,
  servingsOf,
  stepScale,
  yieldLabel,
} from "@recipe-vault/core";
import type RecipeVault from "./main";
import {
  RecipeOutline,
  cookSteps,
  countChecked,
  ingredientLines,
  recipeOutline,
  setTaskLine,
  sliceBody,
  taskLines,
} from "./recipe-structure";

/**
 * `rail` is the wide-pane layout, which only kicks in once the pane is
 * 1000px wide (a container query decides). `kitchen` is the opt-in phone
 * layout with an Ingredients / Steps switch and a bar at the bottom.
 */
export type RecipeLayoutKind = "rail" | "kitchen";

export type RecipeTab = "ingredients" | "steps";

/** What the note's buttons do. The plugin fills these in. */
export interface RecipeActions {
  markMade: (file: TFile) => void;
  addToList: (file: TFile) => void;
  askAi: (file: TFile) => void;
  cook: (file: TFile) => void;
  /** Whether Ask AI is on. Off hides its buttons. */
  aiEnabled: () => boolean;
}

function iconButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  opts: { cls?: string; text?: string } = {},
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: opts.cls,
    attr: { type: "button", "aria-label": label },
  });
  setIcon(button.createSpan({ cls: "recipe-button-icon" }), icon);
  if (opts.text)
    button.createSpan({ cls: "recipe-button-text", text: opts.text });
  return button;
}

/** "Add 4 to shopping list", or a disabled button when nothing's ticked. */
export function setAddCount(
  button: HTMLButtonElement,
  count: number,
  short: boolean,
): void {
  const label = button.querySelector(".recipe-button-text");
  const text =
    count > 0
      ? short
        ? `Add ${count} to list`
        : `Add ${count} to shopping list`
      : short
        ? "Add to list"
        : "Add checked to shopping list";
  if (label) label.textContent = text;
  button.setAttribute("aria-label", text);
  button.disabled = count === 0;
}

/** The row of buttons that sits under the At a Glance callout. */
export function buildRecipeActions(
  file: TFile,
  actions: RecipeActions,
  checked: number,
): HTMLElement {
  const row = createDiv({ cls: "recipe-note-actions" });
  iconButton(row, "circle-check", "Mark as made", {
    text: "Mark as made",
  }).addEventListener("click", () => actions.markMade(file));
  const add = iconButton(row, "shopping-cart", "Add to shopping list", {
    cls: "mod-cta recipe-add-button",
    text: "",
  });
  setAddCount(add, checked, false);
  add.addEventListener("click", () => actions.addToList(file));
  if (actions.aiEnabled()) {
    iconButton(row, "message-circle", "Ask AI", {
      text: "Ask AI",
    }).addEventListener("click", () => actions.askAi(file));
  }
  iconButton(row, "flame", "Cook mode", { text: "Cook" }).addEventListener(
    "click",
    () => actions.cook(file),
  );
  return row;
}

/**
 * Put an ingredient's text in its own span, next to the checkbox, so the row
 * can lay out as checkbox + text without a link or bold word breaking the
 * line into pieces. The checkbox itself is left exactly as the theme drew it.
 */
export function wrapTaskText(root: HTMLElement): void {
  root.querySelectorAll("li.task-list-item").forEach((li) => {
    if (li.querySelector(":scope > .recipe-item-text")) return;
    const input = li.querySelector(":scope > input.task-list-item-checkbox");
    if (!input) return;
    const span = createSpan({ cls: "recipe-item-text" });
    const keep = (node: ChildNode) =>
      node === input ||
      (node.instanceOf(HTMLElement) &&
        (node.matches("ul, ol, .list-collapse-indicator") ||
          node.hasClass("collapse-indicator")));
    for (const node of Array.from(li.childNodes)) {
      if (!keep(node)) span.appendChild(node);
    }
    input.after(span);
  });
}

/**
 * Minus, what the recipe makes now, plus. With servings in the note it moves
 * a serving at a time and says "Serves 6"; without, it goes through ½×, 1×,
 * 1½×, 2× and so on. The middle puts it back to as written.
 *
 * The factor lives on the element, so `syncScaleControl` can bring a control
 * up to date wherever it was drawn without redrawing it.
 */
export function buildScaleControl(
  servings: string,
  factor: number,
  onChange: (factor: number) => void,
): HTMLElement {
  const el = createDiv({
    cls: "recipe-scale",
    attr: { role: "group", "aria-label": "Scale recipe" },
  });
  el.dataset.servings = servings;
  const base = servingsOf(servings);
  const current = () => Number(el.dataset.factor) || 1;

  const down = el.createEl("button", {
    cls: "recipe-scale-step clickable-icon",
    attr: { type: "button", "aria-label": "Scale down" },
  });
  setIcon(down, "minus");
  const label = el.createEl("button", {
    cls: "recipe-scale-label",
    attr: { type: "button" },
  });
  const up = el.createEl("button", {
    cls: "recipe-scale-step clickable-icon",
    attr: { type: "button", "aria-label": "Scale up" },
  });
  setIcon(up, "plus");

  down.addEventListener("click", () =>
    onChange(stepScale(current(), -1, base)),
  );
  up.addEventListener("click", () => onChange(stepScale(current(), 1, base)));
  label.addEventListener("click", () => onChange(1));
  syncScaleControl(el, factor);
  return el;
}

/** Bring a control from `buildScaleControl` up to `factor`. */
export function syncScaleControl(el: HTMLElement, factor: number): void {
  el.dataset.factor = String(factor);
  const servings = el.dataset.servings ?? "";
  const base = servingsOf(servings);
  const scaled = factor !== 1;
  const text = yieldLabel(servings, factor) || scaleLabel(factor);

  const label = el.querySelector<HTMLButtonElement>(".recipe-scale-label");
  if (label) {
    label.empty();
    label.createSpan({ text });
    if (scaled && base !== null) {
      label.createSpan({
        cls: "recipe-scale-factor",
        text: scaleLabel(factor),
      });
    }
    label.disabled = !scaled;
    label.setAttribute(
      "aria-label",
      scaled ? `${text}. Reset to as written` : text,
    );
    label.toggleClass("is-scaled", scaled);
  }
  const [down, up] = Array.from(
    el.querySelectorAll<HTMLButtonElement>(".recipe-scale-step"),
  );
  if (down) down.disabled = stepScale(factor, -1, base) === factor;
  if (up) up.disabled = stepScale(factor, 1, base) === factor;
}

/** What each rendered ingredient's text said before any scaling touched it. */
const writtenText = new WeakMap<Text, string>();

function firstText(node: Node): Text | null {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) return child as Text;
      continue;
    }
    const found = firstText(child);
    if (found) return found;
  }
  return null;
}

/**
 * Scale the amounts in rendered ingredient rows. Only the row's first piece
 * of text changes, which is where the amount is, so a link or a bold word
 * later in the line stays as Obsidian drew it. The note itself isn't touched:
 * a scale is for tonight, not the recipe.
 */
export function scaleRenderedIngredients(
  root: HTMLElement,
  factor: number,
): void {
  root.querySelectorAll(".recipe-item-text").forEach((span) => {
    const text = firstText(span);
    if (!text) return;
    const written = writtenText.get(text) ?? text.data;
    writtenText.set(text, written);
    const next = scaleIngredientLine(written, factor);
    if (text.data !== next) text.data = next;
  });
}

/**
 * Where to scroll after the Ingredients / Steps switch. Back to where that
 * tab was left, if it's been open before. The first time, to the start of
 * its section, just under the sticky switch, but only when that's further
 * up than the reader already is: someone still looking at the photo stays
 * looking at it.
 */
export function tabScrollTop(
  scroller: HTMLElement,
  section: Element | null,
  saved: number | undefined,
  sticky: number,
): number {
  if (saved !== undefined) return saved;
  if (!section) return scroller.scrollTop;
  const top =
    section.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    sticky -
    8;
  return Math.max(0, Math.min(scroller.scrollTop, top));
}

/** A line's words without its markdown, for comparing with rendered text. */
function plainWords(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[[\]*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whether a rendered section is the note's ingredient list, going by its
 * rows rather than its line numbers: at least half of them are ingredient
 * lines. Ticks don't matter, and the comparison is on plain words, since a
 * row's rendered text has lost its markdown.
 */
export function isIngredientList(el: HTMLElement, text: string): boolean {
  const items = Array.from(el.querySelectorAll("li.task-list-item"));
  if (items.length === 0) return false;
  const range = recipeOutline(text).ingredients;
  if (!range) return false;
  const lines = new Set(ingredientLines(text, range).map(plainWords));
  const hits = items.filter((li) =>
    lines.has(plainWords(li.textContent ?? "")),
  );
  return hits.length >= Math.ceil(items.length / 2);
}

/**
 * Lay the callout's "**Label**: value" lines out as a grid. They render as
 * one paragraph with line breaks, so each break starts a new cell.
 */
export function gridMetaCallout(section: HTMLElement): void {
  const content = section.querySelector(
    '.callout[data-callout="recipe-meta"] .callout-content',
  );
  if (!content) return;
  content.querySelectorAll(":scope > p").forEach((p) => {
    const grid = createDiv({ cls: "recipe-meta-grid" });
    let cell: HTMLElement | null = null;
    for (const node of Array.from(p.childNodes)) {
      if (node.instanceOf(HTMLBRElement)) {
        cell = null;
        continue;
      }
      // With strict line breaks on there are no <br>s, so a bold label
      // that isn't the cell's first thing starts the next one.
      if (
        cell &&
        node.instanceOf(HTMLElement) &&
        node.tagName === "STRONG" &&
        cell.querySelector("strong")
      ) {
        cell = null;
      }
      if (!cell) {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
          continue;
        }
        cell = grid.createDiv({ cls: "recipe-meta-item" });
      }
      cell.appendChild(node);
    }
    p.replaceWith(grid);
  });
}

/**
 * The view-level parts of a recipe note in reading view. Reading view only
 * keeps the sections near the viewport in the dom, so anything that has to
 * stay put (the rail, the tab switch, the dock) is mounted on the scroller
 * itself, outside the sizer whose children come and go.
 *
 * Owned by its `MarkdownView` through `addChild`, so closing the view tears
 * it down. The plugin swaps it out on file or mode change.
 */
export class RecipeNoteLayout extends Component {
  private text = "";
  private outline: RecipeOutline = recipeOutline("");
  private headingKey = "";
  private railEl: HTMLElement | null = null;
  private railOwner: Component | null = null;
  /** The file line of each rail checkbox, in rail order. */
  private railLines: number[] = [];
  private railSource = "";
  private tabsEl: HTMLElement | null = null;
  private dockEl: HTMLElement | null = null;
  private tab: RecipeTab = "ingredients";
  /** Where each tab was scrolled to when it was last left. */
  private tabScroll: Partial<Record<RecipeTab, number>> = {};
  /** Off once unloaded, so a read that finishes late doesn't touch the dom. */
  private live = false;
  /** Bumped per rail render, so a slow render can't land over a newer one. */
  private railGen = 0;

  constructor(
    private readonly plugin: RecipeVault,
    private readonly view: MarkdownView,
    readonly file: TFile,
    readonly kind: RecipeLayoutKind,
    private readonly actions: RecipeActions,
  ) {
    super();
  }

  /** `.markdown-preview-view`, the scroller. */
  private get previewEl(): HTMLElement | null {
    const root = this.view.previewMode.containerEl;
    if (root.matches(".markdown-preview-view")) return root;
    return root.querySelector<HTMLElement>(":scope > .markdown-preview-view");
  }

  /** The reading view around the preview: the container the css sizes by. */
  private get paneEl(): HTMLElement | null {
    const parent = this.previewEl?.parentElement;
    return parent?.matches(".markdown-reading-view") ? parent : null;
  }

  onload(): void {
    const preview = this.previewEl;
    if (!preview) return;
    this.live = true;
    this.paneEl?.addClass("is-recipe-pane");

    if (this.kind === "rail") {
      preview.addClass("has-recipe-rail");
      this.railEl = createDiv({ cls: "recipe-rail" });
      preview.prepend(this.railEl);
      this.listenToRail(this.railEl);
    } else {
      preview.addClass("recipe-layout-kitchen");
      preview.dataset.recipeTab = this.tab;
      this.mountTabs(preview);
      this.mountDock(preview);
      this.registerDomEvent(preview, "click", (event) => this.toggleRow(event));
    }

    this.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        if (file === this.file) void this.refresh();
      }),
    );
    this.watchSizer(preview);
    void this.refresh();
  }

  /**
   * Catch an ingredient list reading view put back without its tag.
   *
   * After an edit (ticking a box from the rail, say) reading view swaps in a
   * re-rendered list, and doesn't always run it past the post-processor in a
   * way that can tell which lines it is. An untagged list isn't hidden, so it
   * showed up in the main column next to the rail until the next re-render
   * happened to tag it. Watching the sizer catches it whichever way it
   * arrives. Batched to a frame, since scrolling adds and drops sections too.
   */
  private watchSizer(preview: HTMLElement): void {
    const sizer = preview.querySelector<HTMLElement>(
      ":scope > .markdown-preview-sizer",
    );
    if (!sizer) return;
    let queued = 0;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        this.retagSizer(sizer);
      });
    });
    observer.observe(sizer, { childList: true, subtree: true });
    this.register(() => {
      observer.disconnect();
      if (queued) window.cancelAnimationFrame(queued);
    });
  }

  private retagSizer(sizer: HTMLElement): void {
    if (!this.text) return;
    for (const child of Array.from(sizer.children)) {
      if (!child.instanceOf(HTMLElement) || child.dataset.recipeSection) {
        continue;
      }
      if (isIngredientList(child, this.text)) {
        child.dataset.recipeSection = "ingredients";
        this.plugin.prepareIngredientSection(child, this.file);
      }
    }
  }

  onunload(): void {
    this.live = false;
    const preview = this.previewEl;
    this.railEl?.remove();
    this.tabsEl?.remove();
    this.dockEl?.remove();
    this.paneEl?.removeClass("is-recipe-pane");
    if (!preview) return;
    preview.removeClass("has-recipe-rail", "recipe-layout-kitchen");
    delete preview.dataset.recipeTab;
  }

  /** Read the note again and bring every count and the rail up to date. */
  private async refresh(): Promise<void> {
    const text = await this.plugin.app.vault.cachedRead(this.file);
    if (!this.live) return;
    const first = this.text === "";
    this.text = text;
    this.outline = recipeOutline(text);

    // A renamed or moved heading changes which sections are what, and the
    // sections reading view didn't re-render still carry their old tag.
    // Keyed on what the parts are, not where, so adding a line to the
    // description doesn't re-render the whole note.
    const lines = text.split("\n");
    const { hero, meta, ingredients, instructions, notes } = this.outline;
    const headingKey = JSON.stringify(
      [hero, meta, ingredients, instructions, notes].map((range) =>
        range ? lines[range.start] : null,
      ),
    );
    if (!first && headingKey !== this.headingKey) {
      this.view.previewMode.rerender(true);
    }
    this.headingKey = headingKey;

    this.updateCounts();
    const sizer = this.previewEl?.querySelector<HTMLElement>(
      ":scope > .markdown-preview-sizer",
    );
    if (sizer) this.retagSizer(sizer);
    if (this.railEl) await this.renderRail(this.railEl);
  }

  private checkedCount(): number {
    const range = this.outline.ingredients;
    return range ? countChecked(this.text, range) : 0;
  }

  private updateCounts(): void {
    const preview = this.previewEl;
    if (!preview) return;
    const checked = this.checkedCount();
    preview
      .querySelectorAll<HTMLButtonElement>(".recipe-add-button")
      .forEach((button) =>
        setAddCount(button, checked, !!button.closest(".recipe-dock")),
      );

    const ingredients = this.outline.ingredients;
    const total = ingredients ? taskLines(this.text, ingredients).length : 0;
    this.railEl
      ?.querySelector(".recipe-rail-count")
      ?.setText(total ? `${checked} of ${total} picked` : "");

    if (this.tabsEl) {
      this.tabsEl
        .querySelector('[data-tab="ingredients"] .recipe-tab-count')
        ?.setText(total ? String(total) : "");
      const steps = this.outline.instructions
        ? cookSteps(this.text, this.outline.instructions).length
        : 0;
      this.tabsEl
        .querySelector('[data-tab="steps"] .recipe-tab-count')
        ?.setText(steps ? String(steps) : "");
    }
  }

  // ----------------------------------------------------------------- rail

  private async renderRail(rail: HTMLElement): Promise<void> {
    const { hero, ingredients } = this.outline;
    const heroText = hero ? sliceBody(this.text, hero, false).text : "";
    const body = ingredients ? sliceBody(this.text, ingredients) : null;
    const source = JSON.stringify([heroText, body?.text ?? ""]);

    // Ticking a box rewrites the file, which lands back here. If the only
    // change is ticks, flip them in place rather than re-rendering the
    // list under the finger that just tapped it.
    const unticked = (s: string) => s.replace(/\[[^\]\n]\]/g, "[ ]");
    if (this.railSource && unticked(source) === unticked(this.railSource)) {
      this.railSource = source;
      // The lines can still have moved, if something above them changed.
      this.railLines = ingredients ? taskLines(this.text, ingredients) : [];
      this.syncRailTicks(rail);
      this.updateCounts();
      return;
    }
    this.railSource = source;
    const gen = ++this.railGen;

    const owner = new Component();
    const next = createDiv();
    // Rendered detached, so the plugin's own post-processor can't mistake
    // these sections for the note's.
    if (heroText) {
      const heroEl = next.createDiv({ cls: "recipe-hero" });
      await MarkdownRenderer.render(
        this.plugin.app,
        heroText,
        heroEl,
        this.file.path,
        owner,
      );
    }
    if (body) {
      const head = next.createDiv({ cls: "recipe-rail-head" });
      head.createEl("h3", { text: "Ingredients" });
      head.createSpan({ cls: "recipe-rail-count" });
      next.append(this.plugin.recipeScaleControl(this.file));
      const list = next.createDiv({ cls: "recipe-rail-list" });
      await MarkdownRenderer.render(
        this.plugin.app,
        body.text,
        list,
        this.file.path,
        owner,
      );
      wrapTaskText(list);
    }
    next
      .querySelectorAll("[data-recipe-section], .recipe-note-actions")
      .forEach((el) =>
        el.hasClass("recipe-note-actions")
          ? el.remove()
          : el.removeAttribute("data-recipe-section"),
      );
    // The list's own post-processing may have added a control of its own.
    next
      .querySelectorAll(".recipe-rail-list .recipe-scale")
      .forEach((el) => el.remove());
    scaleRenderedIngredients(next, this.plugin.recipeScale(this.file));

    if (!this.live || gen !== this.railGen) {
      owner.unload();
      return;
    }
    if (this.railOwner) this.removeChild(this.railOwner);
    this.railOwner = this.addChild(owner);

    const scroll = rail.scrollTop;
    rail.replaceChildren(...Array.from(next.childNodes));
    rail.scrollTop = scroll;
    this.railLines = ingredients ? taskLines(this.text, ingredients) : [];
    this.syncRailTicks(rail);
    this.updateCounts();
  }

  /** Match each rail checkbox to the file, by order. */
  private syncRailTicks(rail: HTMLElement): void {
    const lines = this.text.split("\n");
    rail
      .querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")
      .forEach((input, i) => {
        const line = this.railLines[i];
        if (line === undefined) return;
        const checked = /^\s*(?:[-*+]|\d+[.)])\s+\[[^ ]\]/.test(
          lines[line] ?? "",
        );
        input.checked = checked;
        const li = input.closest("li");
        li?.toggleClass("is-checked", checked);
        li?.setAttribute("data-task", checked ? "x" : " ");
      });
  }

  private listenToRail(rail: HTMLElement): void {
    // Any toggling Obsidian might wire onto rendered markdown would go by
    // the slice's line numbers, not the file's. Stop the click here so only
    // the change handler below writes the file.
    this.registerDomEvent(
      rail,
      "click",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement &&
          target.matches(".task-list-item-checkbox")
        ) {
          event.stopPropagation();
        }
      },
      { capture: true },
    );
    this.registerDomEvent(rail, "click", (event) => this.toggleRow(event));
    this.registerDomEvent(rail, "change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const inputs = Array.from(
        rail.querySelectorAll("input.task-list-item-checkbox"),
      );
      const line = this.railLines[inputs.indexOf(input)];
      if (line === undefined) return;
      const checked = input.checked;
      input.closest("li")?.toggleClass("is-checked", checked);
      // Sets the line to what the box shows instead of flipping it, so a
      // second toggle from anywhere can't undo this one.
      void this.plugin.app.vault.process(this.file, (text) =>
        setTaskLine(text, line, checked),
      );
    });
  }

  /**
   * A tap anywhere on an ingredient row ticks it. Reading view doesn't make
   * the text a label, and themes already use the checkbox's pseudo-elements,
   * so this is a click handler rather than css.
   */
  private toggleRow(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("a, input, button, .list-collapse-indicator")) return;
    const li = target.closest("li.task-list-item");
    const input = li?.querySelector<HTMLInputElement>(
      ":scope > input.task-list-item-checkbox",
    );
    input?.click();
  }

  // -------------------------------------------------------------- kitchen

  private mountTabs(preview: HTMLElement): void {
    const bar = createDiv({ cls: "recipe-tabs" });
    const track = bar.createDiv({
      cls: "recipe-tabs-track",
      attr: { role: "tablist", "aria-label": "Recipe sections" },
    });
    for (const [tab, label] of [
      ["ingredients", "Ingredients"],
      ["steps", "Steps"],
    ] as const) {
      const button = track.createEl("button", {
        cls: "recipe-tab",
        attr: {
          type: "button",
          role: "tab",
          "data-tab": tab,
          "aria-selected": String(this.tab === tab),
        },
      });
      button.createSpan({ text: label });
      button.createSpan({ cls: "recipe-tab-count" });
      button.addEventListener("click", () => this.setTab(tab));
    }
    iconButton(bar, "flame", "Cook mode", {
      cls: "recipe-tabs-cook",
      text: "Cook",
    }).addEventListener("click", () => this.actions.cook(this.file));
    preview.prepend(bar);
    this.tabsEl = bar;
  }

  private setTab(tab: RecipeTab): void {
    const preview = this.previewEl;
    if (!preview || tab === this.tab) return;
    this.tabScroll[this.tab] = preview.scrollTop;
    this.tab = tab;
    preview.dataset.recipeTab = tab;
    this.tabsEl
      ?.querySelectorAll(".recipe-tab")
      .forEach((el) =>
        el.setAttribute(
          "aria-selected",
          String(el.getAttribute("data-tab") === tab),
        ),
      );
    // After the hidden half is gone from the layout, so the section is
    // measured where it now sits.
    const role = tab === "ingredients" ? "ingredients" : "instructions";
    window.requestAnimationFrame(() => {
      const section = preview.querySelector(
        `:scope > .markdown-preview-sizer > [data-recipe-section="${role}"]`,
      );
      preview.scrollTop = tabScrollTop(
        preview,
        section,
        this.tabScroll[tab],
        this.tabsEl?.offsetHeight ?? 0,
      );
    });
  }

  private mountDock(preview: HTMLElement): void {
    const dock = createDiv({ cls: "recipe-dock" });
    iconButton(dock, "circle-check", "Mark as made", {
      cls: "recipe-dock-icon",
    }).addEventListener("click", () => this.actions.markMade(this.file));
    if (this.actions.aiEnabled()) {
      iconButton(dock, "message-circle", "Ask AI", {
        cls: "recipe-dock-icon",
      }).addEventListener("click", () => this.actions.askAi(this.file));
    }
    const add = iconButton(dock, "shopping-cart", "Add to list", {
      cls: "mod-cta recipe-add-button",
      text: "",
    });
    add.addEventListener("click", () => this.actions.addToList(this.file));
    setAddCount(add, 0, true);
    preview.append(dock);
    this.dockEl = dock;
  }
}
