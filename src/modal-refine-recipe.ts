import { App, Modal, Setting } from "obsidian";

export interface RecipeRefineModalData {
  prompt: string;
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

export class RefineRecipeModal extends Modal {
  private readonly data: RecipeRefineModalData;
  private readonly onApply: (
    result: RecipeRefineApplyResult,
  ) => Promise<void> | void;

  constructor(
    app: App,
    data: RecipeRefineModalData,
    onApply: (result: RecipeRefineApplyResult) => Promise<void> | void,
  ) {
    super(app);
    this.data = data;
    this.onApply = onApply;
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
    name: string,
    before: string[],
    after: string[],
  ): void {
    const wrapper = this.contentEl.createDiv({ cls: "recipe-ai-diff-section" });
    wrapper.createEl("h4", { text: name });
    const pre = wrapper.createEl("pre", { cls: "recipe-ai-diff-block" });
    pre.textContent = this.buildDiffLines(before, after).join("\n");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Review AI recipe edits" });
    contentEl.createEl("p", {
      text: "Confirm these diffs before they are written to the note.",
      cls: "setting-item-description",
    });

    contentEl.createEl("p", {
      text: `AI summary: ${this.data.summary.trim() || "No summary provided."}`,
      cls: "setting-item-description",
    });

    new Setting(contentEl).setName("Prompt").addTextArea((text) => {
      text.setValue(this.data.prompt);
      text.inputEl.rows = 3;
      text.inputEl.style.width = "100%";
      text.inputEl.readOnly = true;
    });

    this.renderDiffSection(
      "Ingredient diff",
      this.data.originalIngredients,
      this.data.suggestedIngredients,
    );
    this.renderDiffSection(
      "Instruction diff",
      this.data.originalInstructions,
      this.data.suggestedInstructions,
    );

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Apply edits")
          .setCta()
          .onClick(() => {
            void this.onApply({
              recipeIngredient: this.data.suggestedIngredients,
              recipeInstructions: this.data.suggestedInstructions,
            });
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
