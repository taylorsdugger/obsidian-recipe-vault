import { App, Component, Modal, setIcon } from "obsidian";
import { ConfirmModal } from "./modal-confirm";

export interface CookModeStep {
  /** The step as written. Markdown for a note, plain text for a `.cook` file. */
  text: string;
  /** The sub-section it sits under, or "". */
  group: string;
  /** Ingredient labels the step mentions, for the "For this step" row. */
  uses: string[];
}

export interface CookModeOptions {
  title: string;
  steps: CookModeStep[];
  /** The full ingredient list, for the sheet behind the list button. */
  ingredients: string[];
  /** Draw a step's text into `el`. Notes hand it to Obsidian's renderer. */
  renderText: (text: string, el: HTMLElement, owner: Component) => void;
  /** Offered after the last step. Left out, Done just closes. */
  onMarkMade?: () => void;
}

/**
 * One step at a time, big enough to read from across the counter. The next
 * step sits in a card above the buttons so you can see what's coming without
 * leaving the one you're on.
 */
export class CookModeModal extends Modal {
  private readonly options: CookModeOptions;
  private index = 0;
  /** Owns whatever the renderer attaches to a step, and drops it per step. */
  private stepOwner: Component | null = null;
  /** The same for the ingredient sheet, which lives as long as the modal. */
  private sheet: Component | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private closed = false;

  private progressEl!: HTMLElement;
  private labelEl!: HTMLElement;
  private stepEl!: HTMLElement;
  private usesEl!: HTMLElement;
  private nextEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private backButton!: HTMLButtonElement;
  private nextButton!: HTMLButtonElement;
  private sheetEl!: HTMLElement;

  private readonly onVisibility = () => {
    if (document.visibilityState !== "visible" || this.closed) return;
    // The browser drops the lock whenever the app goes to the background.
    if (!this.wakeLock || this.wakeLock.released) void this.lockScreen();
  };

  constructor(app: App, options: CookModeOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { modalEl, contentEl, options } = this;
    modalEl.addClass("recipe-cook-modal");
    contentEl.addClass("recipe-cook");
    // The top bar has its own close button. Obsidian's sits in a different
    // place across versions, so it's found and hidden here rather than
    // trusting one css selector to reach it.
    modalEl
      .querySelectorAll<HTMLElement>(".modal-close-button")
      .forEach((el) => el.hide());

    const top = contentEl.createDiv({ cls: "recipe-cook-top" });
    const close = top.createEl("button", {
      cls: "recipe-cook-icon clickable-icon",
      attr: { type: "button", "aria-label": "Close cook mode" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
    top.createDiv({ cls: "recipe-cook-title", text: options.title });
    const list = top.createEl("button", {
      cls: "recipe-cook-icon clickable-icon",
      attr: { type: "button", "aria-label": "Show ingredients" },
    });
    setIcon(list, "list");
    list.addEventListener("click", () => this.toggleSheet(true));

    this.progressEl = contentEl.createDiv({ cls: "recipe-cook-progress" });
    this.progressEl.style.setProperty(
      "--recipe-cook-steps",
      String(Math.max(options.steps.length, 1)),
    );
    for (let i = 0; i < options.steps.length; i++) {
      this.progressEl.createSpan({ cls: "recipe-cook-segment" });
    }

    const body = contentEl.createDiv({ cls: "recipe-cook-body" });
    this.labelEl = body.createDiv({ cls: "recipe-cook-label" });
    this.stepEl = body.createDiv({ cls: "recipe-cook-step" });
    this.usesEl = body.createDiv({ cls: "recipe-cook-uses" });
    this.nextEl = body.createDiv({ cls: "recipe-cook-next" });

    const foot = contentEl.createDiv({ cls: "recipe-cook-foot" });
    this.hintEl = foot.createDiv({ cls: "recipe-cook-hint" });
    setIcon(this.hintEl.createSpan(), "sun");
    this.hintEl.createSpan({ text: "Screen stays on" });
    this.hintEl.hide();

    const nav = foot.createDiv({ cls: "recipe-cook-nav" });
    this.backButton = nav.createEl("button", {
      cls: "recipe-cook-back",
      attr: { type: "button" },
    });
    this.nextButton = nav.createEl("button", {
      cls: "recipe-cook-forward mod-cta",
      attr: { type: "button" },
    });
    this.backButton.addEventListener("click", () => this.go(-1));
    this.nextButton.addEventListener("click", () => this.forward());

    this.sheetEl = contentEl.createDiv({ cls: "recipe-cook-sheet" });
    const sheetHead = this.sheetEl.createDiv({ cls: "recipe-cook-sheet-head" });
    sheetHead.createEl("h4", { text: "Ingredients" });
    const sheetClose = sheetHead.createEl("button", {
      cls: "recipe-cook-icon clickable-icon",
      attr: { type: "button", "aria-label": "Hide ingredients" },
    });
    setIcon(sheetClose, "x");
    sheetClose.addEventListener("click", () => this.toggleSheet(false));
    const ul = this.sheetEl.createEl("ul");
    for (const line of options.ingredients) {
      options.renderText(line, ul.createEl("li"), this.sheetOwner());
    }
    this.toggleSheet(false);

    // Arrow keys step through on a keyboard. Esc already closes a modal.
    this.scope.register([], "ArrowRight", () => {
      this.go(1);
      return false;
    });
    this.scope.register([], "ArrowLeft", () => {
      this.go(-1);
      return false;
    });

    document.addEventListener("visibilitychange", this.onVisibility);
    void this.lockScreen();
    this.show();
  }

  onClose(): void {
    this.closed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.stepOwner?.unload();
    this.sheet?.unload();
    this.contentEl.empty();
  }

  private sheetOwner(): Component {
    if (!this.sheet) {
      this.sheet = new Component();
      this.sheet.load();
    }
    return this.sheet;
  }

  private async lockScreen(): Promise<void> {
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (this.closed) {
        void lock?.release();
        return;
      }
      this.wakeLock = lock ?? null;
    } catch {
      // Refused (low battery, no permission) or not supported. The hint
      // only shows when the screen really will stay on.
      this.wakeLock = null;
    }
    this.hintEl.toggle(this.wakeLock !== null);
  }

  private toggleSheet(open: boolean): void {
    this.sheetEl.toggleClass("is-open", open);
    this.sheetEl.setAttribute("aria-hidden", String(!open));
  }

  private go(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next >= this.options.steps.length) return;
    this.index = next;
    this.show();
  }

  private forward(): void {
    if (this.index < this.options.steps.length - 1) {
      this.go(1);
      return;
    }
    this.close();
    const { onMarkMade, title } = this.options;
    if (!onMarkMade) return;
    new ConfirmModal(this.app, {
      title: "Mark as made?",
      message: `That was the last step of ${title}. Count it as made today?`,
      confirmText: "Mark as made",
      onConfirm: onMarkMade,
    }).open();
  }

  private show(): void {
    const { steps } = this.options;
    const total = steps.length;
    const step = steps[this.index];

    this.progressEl
      .querySelectorAll(".recipe-cook-segment")
      .forEach((el, i) => {
        el.toggleClass("is-done", i <= this.index);
      });

    this.labelEl.empty();
    this.labelEl.createSpan({
      cls: "recipe-cook-count",
      text: `Step ${this.index + 1} of ${total}`,
    });
    if (step?.group) {
      this.labelEl.createSpan({ cls: "recipe-cook-group", text: step.group });
    }

    this.stepOwner?.unload();
    this.stepOwner = new Component();
    this.stepOwner.load();
    this.stepEl.empty();
    if (step) this.options.renderText(step.text, this.stepEl, this.stepOwner);

    this.usesEl.empty();
    if (step && step.uses.length > 0) {
      this.usesEl.createDiv({
        cls: "recipe-cook-caption",
        text: "For this step",
      });
      const pills = this.usesEl.createDiv({ cls: "recipe-cook-pills" });
      for (const use of step.uses) {
        pills.createSpan({ cls: "recipe-cook-pill", text: use });
      }
    }
    this.usesEl.toggle(!!step && step.uses.length > 0);

    this.nextEl.empty();
    const upcoming = steps[this.index + 1];
    if (upcoming) {
      const label =
        upcoming.group && upcoming.group !== step?.group
          ? `Next · Step ${this.index + 2} · ${upcoming.group}`
          : `Next · Step ${this.index + 2}`;
      this.nextEl.createDiv({ cls: "recipe-cook-caption", text: label });
      const text = this.nextEl.createDiv({ cls: "recipe-cook-next-text" });
      this.options.renderText(upcoming.text, text, this.stepOwner);
    } else {
      this.nextEl.createDiv({ cls: "recipe-cook-caption", text: "Last step" });
    }

    this.backButton.empty();
    setIcon(this.backButton.createSpan(), "chevron-left");
    this.backButton.createSpan({ text: "Back" });
    this.backButton.disabled = this.index === 0;

    const last = this.index >= total - 1;
    this.nextButton.empty();
    this.nextButton.createSpan({ text: last ? "Done" : "Next step" });
    setIcon(this.nextButton.createSpan(), last ? "check" : "chevron-right");
  }
}
