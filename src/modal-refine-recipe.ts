import { App, Modal, Notice } from "obsidian";
import type { ChatMessage } from "./utils/openrouter";

export interface RecipeRefineModalData {
  summary: string;
  originalIngredients: string[];
  originalInstructions: string[];
  suggestedIngredients: string[];
  suggestedInstructions: string[];
}

export interface RecipeRefineApplyResult {
  recipeIngredient: string[];
  recipeInstructions: string[];
}

type EditStatus = "idle" | "loading" | "ready" | "applying" | "applied";

interface EditState {
  status: EditStatus;
  data: RecipeRefineModalData | null;
}

interface UserEntry {
  role: "user";
  content: string;
}

interface AssistantEntry {
  role: "assistant";
  content: string;
  /** Whether the model invited the user to turn this into a recipe edit. */
  offerEdit: boolean;
  edit: EditState;
}

type ChatEntry = UserEntry | AssistantEntry;

/**
 * Conversational "Ask AI" modal. Every message is a plain chat reply shown
 * immediately. When a reply invites a recipe change, an inline "Update the
 * recipe" button appears under it; confirming generates a diff to review and
 * apply. Pure questions never touch the recipe.
 */
export class RefineRecipeModal extends Modal {
  private entries: ChatEntry[] = [];
  private readonly initialPrompt: string;
  private readonly onChat: (
    messages: ChatMessage[],
  ) => Promise<{ reply: string; offerEdit: boolean }>;
  private readonly onSuggestEdit: (
    messages: ChatMessage[],
  ) => Promise<RecipeRefineModalData>;
  private readonly onApply: (
    result: RecipeRefineApplyResult,
  ) => Promise<void> | void;

  private chatLogEl: HTMLDivElement | null = null;
  private promptInputEl: HTMLTextAreaElement | null = null;
  private sendButtonEl: HTMLButtonElement | null = null;
  private isChatInFlight = false;

  constructor(
    app: App,
    onChat: (
      messages: ChatMessage[],
    ) => Promise<{ reply: string; offerEdit: boolean }>,
    onSuggestEdit: (messages: ChatMessage[]) => Promise<RecipeRefineModalData>,
    onApply: (result: RecipeRefineApplyResult) => Promise<void> | void,
    initialPrompt = "",
  ) {
    super(app);
    this.onChat = onChat;
    this.onSuggestEdit = onSuggestEdit;
    this.onApply = onApply;
    this.initialPrompt = initialPrompt;
  }

  private get isBusy(): boolean {
    if (this.isChatInFlight) return true;
    return this.entries.some(
      (entry) =>
        entry.role === "assistant" &&
        (entry.edit.status === "loading" || entry.edit.status === "applying"),
    );
  }

  private toChatMessages(): ChatMessage[] {
    return this.entries.map((entry) => ({
      role: entry.role,
      content: entry.content,
      offeredEdit: entry.role === "assistant" ? entry.offerEdit : undefined,
    }));
  }

  private isLatestAssistant(entry: AssistantEntry): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const current = this.entries[i];
      if (current.role === "assistant") {
        return current === entry;
      }
    }
    return false;
  }

  // --- diff helpers ---------------------------------------------------------

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

  // --- rendering ------------------------------------------------------------

  private renderChatLog(): void {
    if (!this.chatLogEl) return;
    this.chatLogEl.empty();

    for (const entry of this.entries) {
      const wrap = this.chatLogEl.createDiv({ cls: "recipe-ai-chat-entry" });
      wrap.createDiv({
        cls:
          entry.role === "user"
            ? "recipe-ai-chat-user"
            : "recipe-ai-chat-assistant",
        text: entry.content,
      });

      if (entry.role === "assistant") {
        this.renderEditAffordance(wrap, entry);
      }
    }

    // Typing indicator bubble while waiting on a reply.
    if (this.isChatInFlight) {
      const wrap = this.chatLogEl.createDiv({ cls: "recipe-ai-chat-entry" });
      const typing = wrap.createDiv({
        cls: "recipe-ai-chat-assistant recipe-ai-chat-typing",
      });
      for (let i = 0; i < 3; i++) {
        typing.createSpan({ cls: "recipe-ai-typing-dot" });
      }
    }

    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private renderEditAffordance(
    containerEl: HTMLElement,
    entry: AssistantEntry,
  ): void {
    const { status } = entry.edit;

    // An applied edit always shows its marker, on any message.
    if (status === "applied") {
      containerEl.createDiv({
        cls: "recipe-ai-edit-applied",
        text: "✓ Recipe updated.",
      });
      return;
    }

    // Only the most recent reply stays interactive. Once the conversation
    // moves on, earlier offers and un-applied diffs are retired.
    if (!this.isLatestAssistant(entry)) {
      return;
    }

    // No offer and nothing in progress → nothing to render.
    if (!entry.offerEdit && status === "idle") {
      return;
    }

    if (status === "idle") {
      const actions = containerEl.createDiv({ cls: "recipe-ai-edit-actions" });
      const updateBtn = actions.createEl("button", {
        cls: "mod-cta",
        text: "✎ Update the recipe",
      });
      updateBtn.disabled = this.isBusy;
      updateBtn.addEventListener("click", () => void this.confirmEdit(entry));

      const dismissBtn = actions.createEl("button", { text: "Not now" });
      dismissBtn.disabled = this.isBusy;
      dismissBtn.addEventListener("click", () => {
        entry.offerEdit = false;
        this.renderChatLog();
      });
      return;
    }

    if (status === "loading") {
      const actions = containerEl.createDiv({ cls: "recipe-ai-edit-actions" });
      actions.createSpan({
        cls: "setting-item-description",
        text: "Generating recipe edits…",
      });
      return;
    }

    // status is "ready" or "applying" → show the diff, then apply/discard
    // buttons below it so the actions sit where the eye lands after review.
    const data = entry.edit.data;
    if (data) {
      const diffWrapper = containerEl.createDiv({
        cls: "recipe-ai-diff-wrapper",
      });
      this.renderDiffSection(
        diffWrapper,
        "Ingredient diff",
        data.originalIngredients,
        data.suggestedIngredients,
      );
      this.renderDiffSection(
        diffWrapper,
        "Instruction diff",
        data.originalInstructions,
        data.suggestedInstructions,
      );
    }

    const actions = containerEl.createDiv({ cls: "recipe-ai-edit-actions" });
    const applyBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: status === "applying" ? "Applying…" : "Apply edits",
    });
    applyBtn.disabled = this.isBusy;
    applyBtn.addEventListener("click", () => void this.applyEdit(entry));

    const discardBtn = actions.createEl("button", { text: "Discard" });
    discardBtn.disabled = this.isBusy;
    discardBtn.addEventListener("click", () => {
      entry.edit = { status: "idle", data: null };
      entry.offerEdit = false;
      this.renderChatLog();
    });
  }

  private refreshInputState(): void {
    if (this.sendButtonEl) {
      this.sendButtonEl.disabled = this.isBusy;
    }
    if (this.promptInputEl) {
      this.promptInputEl.disabled = this.isBusy;
    }
  }

  private refresh(): void {
    this.renderChatLog();
    this.refreshInputState();
  }

  // --- actions --------------------------------------------------------------

  private async runChat(): Promise<void> {
    if (!this.promptInputEl || this.isBusy) return;

    const prompt = this.promptInputEl.value.trim();
    if (!prompt) {
      new Notice("Enter a question for AI first.");
      return;
    }

    this.promptInputEl.value = "";
    this.promptInputEl.style.height = "auto";
    this.entries.push({ role: "user", content: prompt });
    this.isChatInFlight = true;
    this.refresh();

    try {
      const result = await this.onChat(this.toChatMessages());
      this.entries.push({
        role: "assistant",
        content: result.reply,
        offerEdit: result.offerEdit,
        edit: { status: "idle", data: null },
      });
    } catch (error) {
      this.entries.pop();
      new Notice(this.errorMessage(error), 8000);
    } finally {
      this.isChatInFlight = false;
      this.refresh();
      this.promptInputEl?.focus();
    }
  }

  private async confirmEdit(entry: AssistantEntry): Promise<void> {
    if (this.isBusy) return;

    entry.edit = { status: "loading", data: null };
    this.refresh();

    try {
      const data = await this.onSuggestEdit(this.toChatMessages());
      if (this.hasDiff(data)) {
        entry.edit = { status: "ready", data };
      } else {
        entry.edit = { status: "idle", data: null };
        entry.offerEdit = false;
        new Notice("AI didn't find any recipe changes to make.");
      }
    } catch (error) {
      entry.edit = { status: "idle", data: null };
      new Notice(this.errorMessage(error), 8000);
    } finally {
      this.refresh();
    }
  }

  private async applyEdit(entry: AssistantEntry): Promise<void> {
    const data = entry.edit.data;
    if (!data || this.isBusy) return;

    entry.edit = { status: "applying", data };
    this.refresh();

    try {
      await this.onApply({
        recipeIngredient: data.suggestedIngredients,
        recipeInstructions: data.suggestedInstructions,
      });
      entry.edit = { status: "applied", data };
    } catch (error) {
      entry.edit = { status: "ready", data };
      new Notice(this.errorMessage(error), 8000);
    } finally {
      this.refresh();
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : "AI request failed. Please try again.";
  }

  // --- lifecycle ------------------------------------------------------------

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Ask AI about this recipe" });
    contentEl.createEl("p", {
      text: "Ask anything about this recipe. If a change would help, the AI will offer to update it.",
      cls: "setting-item-description",
    });

    this.chatLogEl = contentEl.createDiv({ cls: "recipe-ai-chat-log" });

    // Messaging-app style composer: rounded textarea + send button in one row.
    const composer = contentEl.createDiv({ cls: "recipe-ai-composer" });

    this.promptInputEl = composer.createEl("textarea", {
      cls: "recipe-ai-composer-input",
      attr: {
        rows: "1",
        placeholder: "Ask about this recipe…",
      },
    });
    this.promptInputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.runChat();
      }
    });
    // Auto-grow up to a few lines as the user types.
    this.promptInputEl.addEventListener("input", () => {
      const el = this.promptInputEl;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });

    this.sendButtonEl = composer.createEl("button", {
      cls: "recipe-ai-composer-send mod-cta",
      text: "➤",
      attr: { type: "button", "aria-label": "Send" },
    });
    this.sendButtonEl.addEventListener("click", () => void this.runChat());

    this.refresh();

    // Auto-send the prompt the user typed on the note that opened this modal.
    if (this.initialPrompt && this.promptInputEl) {
      this.promptInputEl.value = this.initialPrompt;
      void this.runChat();
    } else {
      this.promptInputEl?.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
