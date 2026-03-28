import { App, Modal, Notice, Setting } from "obsidian";
import type { ChatMessage } from "./utils/openrouter";

export interface RecipeRefineModalData {
  prompt: string;
  summary: string;
  originalIngredients: string[];
  originalInstructions: string[];
  suggestedIngredients: string[];
  suggestedInstructions: string[];
  suggestEdits: boolean;
}

export interface RecipeRefineApplyResult {
  recipeIngredient: string[];
  recipeInstructions: string[];
}

export class RefineRecipeModal extends Modal {
  private data: RecipeRefineModalData;
  private chatMessages: ChatMessage[] = [];
  private readonly initialPrompt: string;
  private readonly onAsk: (prompt: string) => Promise<RecipeRefineModalData>;
  private readonly onChat: (messages: ChatMessage[]) => Promise<string>;
  private readonly onApply: (
    result: RecipeRefineApplyResult,
  ) => Promise<void> | void;

  private chatLogEl: HTMLDivElement | null = null;
  private diffWrapperEl: HTMLDivElement | null = null;
  private emptyDiffEl: HTMLParagraphElement | null = null;
  private reviewButtonEl: HTMLButtonElement | null = null;
  private applyButtonEl: HTMLButtonElement | null = null;
  private askButtonEl: HTMLButtonElement | null = null;
  private suggestEditsButtonEl: HTMLButtonElement | null = null;
  private promptInputEl: HTMLTextAreaElement | null = null;
  private isReviewVisible = false;
  private isRequestInFlight = false;
  private isApplyInFlight = false;

  constructor(
    app: App,
    data: RecipeRefineModalData,
    initialPrompt: string,
    onAsk: (prompt: string) => Promise<RecipeRefineModalData>,
    onChat: (messages: ChatMessage[]) => Promise<string>,
    onApply: (result: RecipeRefineApplyResult) => Promise<void> | void,
  ) {
    super(app);
    this.data = data;
    this.initialPrompt = initialPrompt;
    this.onAsk = onAsk;
    this.onChat = onChat;
    this.onApply = onApply;
  }

  private hasDiff(data: RecipeRefineModalData): boolean {
    if (data.originalIngredients.length !== data.suggestedIngredients.length) {
      return true;
    }
    if (
      data.originalInstructions.length !== data.suggestedInstructions.length
    ) {
      return true;
    }

    const ingredientsChanged = data.originalIngredients.some(
      (line, index) => line !== data.suggestedIngredients[index],
    );
    if (ingredientsChanged) {
      return true;
    }

    return data.originalInstructions.some(
      (line, index) => line !== data.suggestedInstructions[index],
    );
  }

  private buildDiffLines(before: string[], after: string[]): string[] {
    const n = before.length;
    const m = after.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
      Array.from({ length: m + 1 }, () => 0),
    );

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (before[i] === after[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    const diffLines: string[] = [];
    let i = 0;
    let j = 0;

    while (i < n && j < m) {
      if (before[i] === after[j]) {
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        diffLines.push(`- ${before[i]}`);
        i++;
      } else {
        diffLines.push(`+ ${after[j]}`);
        j++;
      }
    }

    while (i < n) {
      diffLines.push(`- ${before[i]}`);
      i++;
    }

    while (j < m) {
      diffLines.push(`+ ${after[j]}`);
      j++;
    }

    if (diffLines.length === 0) {
      return ["No changes suggested."];
    }

    return diffLines;
  }

  private renderDiffSection(
    containerEl: HTMLElement,
    name: string,
    before: string[],
    after: string[],
  ): void {
    const wrapper = containerEl.createDiv({ cls: "recipe-ai-diff-section" });
    wrapper.createEl("h4", { text: name });
    const pre = wrapper.createEl("pre", { cls: "recipe-ai-diff-block" });
    pre.textContent = this.buildDiffLines(before, after).join("\n");
  }

  private renderChatLog(): void {
    if (!this.chatLogEl) return;
    this.chatLogEl.empty();

    for (const msg of this.chatMessages) {
      const entry = this.chatLogEl.createDiv({ cls: "recipe-ai-chat-entry" });
      entry.createDiv({
        cls:
          msg.role === "user"
            ? "recipe-ai-chat-user"
            : "recipe-ai-chat-assistant",
        text: `${msg.role === "user" ? "You" : "AI"}: ${msg.content}`,
      });
    }

    // Auto-scroll to latest message
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private refreshReviewState(): void {
    const hasDiff = this.hasDiff(this.data);
    const busy = this.isRequestInFlight || this.isApplyInFlight;

    if (this.reviewButtonEl) {
      this.reviewButtonEl.style.display = hasDiff ? "" : "none";
      this.reviewButtonEl.textContent = this.isReviewVisible
        ? "Hide suggested edits"
        : "Review suggested edits";
      this.reviewButtonEl.disabled = busy;
    }

    if (this.emptyDiffEl) {
      this.emptyDiffEl.style.display = hasDiff ? "none" : "";
      this.emptyDiffEl.textContent = this.data.suggestEdits
        ? "AI did not produce diffable edits for this response."
        : "No recipe edits suggested for this response.";
    }

    if (this.diffWrapperEl) {
      this.diffWrapperEl.empty();
      this.diffWrapperEl.style.display =
        hasDiff && this.isReviewVisible ? "" : "none";

      if (hasDiff && this.isReviewVisible) {
        this.renderDiffSection(
          this.diffWrapperEl,
          "Ingredient diff",
          this.data.originalIngredients,
          this.data.suggestedIngredients,
        );
        this.renderDiffSection(
          this.diffWrapperEl,
          "Instruction diff",
          this.data.originalInstructions,
          this.data.suggestedInstructions,
        );
      }
    }

    if (this.applyButtonEl) {
      this.applyButtonEl.style.display =
        hasDiff && this.isReviewVisible ? "" : "none";
      this.applyButtonEl.disabled = busy || !hasDiff;
      this.applyButtonEl.textContent = this.isApplyInFlight
        ? "Applying..."
        : "Apply edits";
    }

    if (this.askButtonEl) {
      this.askButtonEl.disabled = busy;
      this.askButtonEl.textContent = this.isRequestInFlight
        ? "Asking..."
        : "Ask";
    }

    if (this.suggestEditsButtonEl) {
      this.suggestEditsButtonEl.disabled = busy;
    }

    if (this.promptInputEl) {
      this.promptInputEl.disabled = busy;
    }
  }

  private async runAsk(): Promise<void> {
    if (!this.promptInputEl) {
      return;
    }

    const prompt = this.promptInputEl.value.trim();
    if (!prompt) {
      new Notice("Enter a question for AI first.");
      return;
    }

    this.promptInputEl.value = "";
    this.isRequestInFlight = true;
    this.refreshReviewState();

    try {
      const nextData = await this.onAsk(prompt);
      this.data = nextData;
      this.isReviewVisible = false;
      this.renderChatLog();
      this.refreshReviewState();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI request failed. Please try again.";
      new Notice(message, 8000);
    } finally {
      this.isRequestInFlight = false;
      this.refreshReviewState();
      this.promptInputEl.focus();
    }
  }

  private async runApply(): Promise<void> {
    if (!this.hasDiff(this.data) || this.isApplyInFlight) {
      return;
    }

    this.isApplyInFlight = true;
    this.refreshReviewState();

    try {
      await this.onApply({
        recipeIngredient: this.data.suggestedIngredients,
        recipeInstructions: this.data.suggestedInstructions,
      });
      this.close();
    } finally {
      this.isApplyInFlight = false;
      this.refreshReviewState();
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Ask AI about this recipe" });
    contentEl.createEl("p", {
      text: "You can ask follow-up questions. Review diffs before applying recipe edits.",
      cls: "setting-item-description",
    });

    this.chatLogEl = contentEl.createDiv({ cls: "recipe-ai-summary-log" });
    this.renderChatLog();

    new Setting(contentEl).setName("Ask AI").addTextArea((text) => {
      this.promptInputEl = text.inputEl;
      text.setPlaceholder("Try: I do not eat vinegar. What should I change?");
      text.inputEl.rows = 3;
      text.inputEl.style.width = "100%";
      text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void this.runAsk();
        }
      });
    });

    this.emptyDiffEl = contentEl.createEl("p", {
      cls: "setting-item-description",
    });

    this.diffWrapperEl = contentEl.createDiv({ cls: "recipe-ai-diff-wrapper" });

    new Setting(contentEl)
      .addButton((btn) => {
        this.askButtonEl = btn.buttonEl;
        btn
          .setButtonText("Ask AI")
          .setCta()
          .onClick(() => {
            void this.runAsk();
          });
      })
      .addButton((btn) => {
        this.reviewButtonEl = btn.buttonEl;
        btn.setButtonText("Review suggested edits").onClick(() => {
          this.isReviewVisible = !this.isReviewVisible;
          this.refreshReviewState();
        });
      })
      .addButton((btn) => {
        this.applyButtonEl = btn.buttonEl;
        btn
          .setButtonText("Apply edits")
          .setCta()
          .onClick(() => {
            void this.runApply();
          });
      })
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      );

    this.refreshReviewState();
    this.promptInputEl?.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
