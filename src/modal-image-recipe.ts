import { App, Modal, Notice, Setting } from "obsidian";
import {
  OcrRecognitionResult,
  parseRecipeText,
  ParsedRecipe,
  recognizeTextWithMetadata,
} from "./ocr-parser";

export type ImageOption = "use" | "different" | "none";

export interface ImageRecipeResult {
  recipe: ParsedRecipe;
  imageOption: ImageOption;
  /** The original uploaded image file (step 1). Available when imageOption is "use". */
  originalImageFile?: File;
  /** A separately chosen food photo. Available when imageOption is "different". */
  differentImageFile?: File;
}

class OcrReviewModal extends Modal {
  private ocrResult: OcrRecognitionResult;
  private onAccept: () => void;
  private onCancel: () => void;
  private resolved = false;

  constructor(
    app: App,
    ocrResult: OcrRecognitionResult,
    onAccept: () => void,
    onCancel: () => void,
  ) {
    super(app);
    this.ocrResult = ocrResult;
    this.onAccept = onAccept;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Review OCR quality" });
    contentEl.createEl("p", {
      text: "Check OCR quality before parsing recipe fields.",
      cls: "setting-item-description",
    });

    const meta = this.ocrResult.metadata;
    contentEl.createEl("p", {
      text: `Confidence: ${Math.round(meta.confidence)}%`,
    });
    contentEl.createEl("p", {
      text: `Orientation correction: ${meta.orientationDegrees}°`,
    });
    contentEl.createEl("p", {
      text: `Margin crop: ${meta.cropApplied ? "applied" : "not applied"}`,
    });

    const img = contentEl.createEl("img", { cls: "recipe-image-preview" });
    img.src = meta.preprocessedImageDataUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "260px";
    img.style.marginBottom = "1em";
    img.style.borderRadius = "6px";

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Rescan").onClick(() => {
          this.resolved = true;
          this.close();
          this.onCancel();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Use OCR result")
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.close();
            this.onAccept();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onCancel();
    }
  }
}

export class ImageRecipeModal extends Modal {
  private onSubmit: (result: ImageRecipeResult) => void;
  private ocrStrictCleanup: boolean;

  private step = 1;
  private imageFile: File | null = null;
  private imagePreviewUrl: string | null = null;
  private parsedRecipe: ParsedRecipe | null = null;
  private imageOption: ImageOption = "none";
  private differentImageFile: File | null = null;

  constructor(
    app: App,
    onSubmit: (result: ImageRecipeResult) => void,
    ocrStrictCleanup = true,
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.ocrStrictCleanup = ocrStrictCleanup;
  }

  onOpen() {
    this.renderStep();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.imagePreviewUrl) {
      URL.revokeObjectURL(this.imagePreviewUrl);
    }
  }

  /* --------------------------------- Steps --------------------------------- */

  private renderStep() {
    const { contentEl } = this;
    contentEl.empty();

    switch (this.step) {
      case 1:
        this.renderStepPick(contentEl);
        break;
      case 2:
        this.renderStepEdit(contentEl);
        break;
      case 3:
        this.renderStepImage(contentEl);
        break;
    }
  }

  /* ---------------------- Step 1 — Pick & scan image ----------------------- */

  private renderStepPick(el: HTMLElement) {
    el.createEl("h3", { text: "Step 1: Pick the recipe photo" });

    // File picker
    new Setting(el).setName("Recipe image").addButton((btn) =>
      btn.setButtonText("Choose image…").onClick(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp,image/heic";
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) {
            this.imageFile = file;
            if (this.imagePreviewUrl) URL.revokeObjectURL(this.imagePreviewUrl);
            this.imagePreviewUrl = URL.createObjectURL(file);
            this.renderStep(); // re-render to show preview
          }
        };
        input.click();
      }),
    );

    // Preview
    if (this.imagePreviewUrl) {
      const img = el.createEl("img", { cls: "recipe-image-preview" });
      img.src = this.imagePreviewUrl;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "200px";
      img.style.marginBottom = "1em";
      img.style.borderRadius = "6px";
    }

    // Scan button
    new Setting(el).addButton((btn) =>
      btn
        .setButtonText("Scan Recipe")
        .setCta()
        .setDisabled(!this.imageFile)
        .onClick(async () => {
          if (!this.imageFile || !this.imagePreviewUrl) return;
          const notice = new Notice("Scanning recipe image…", 0);
          try {
            const ocrResult = await recognizeTextWithMetadata(
              this.imagePreviewUrl,
              (progress) => {
                notice.setMessage(
                  `Scanning recipe… ${Math.round(progress * 100)}%`,
                );
              },
            );
            notice.hide();
            const accepted = await this.confirmOcrBeforeParse(ocrResult);
            if (!accepted) {
              return;
            }

            this.parsedRecipe = parseRecipeText(ocrResult.text, {
              strictCleanup: this.ocrStrictCleanup,
            });
            this.step = 2;
            this.renderStep();
          } catch (err) {
            notice.hide();
            const message =
              err instanceof Error
                ? err.message
                : "OCR failed — please try a clearer image.";
            new Notice(message, 8000);
            console.error("Recipe OCR error:", err);
          }
        }),
    );
  }

  private confirmOcrBeforeParse(
    ocrResult: OcrRecognitionResult,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      new OcrReviewModal(
        this.app,
        ocrResult,
        () => settle(true),
        () => settle(false),
      ).open();
    });
  }

  /* -------------------- Step 2 — Review & edit fields ---------------------- */

  private renderStepEdit(el: HTMLElement) {
    if (!this.parsedRecipe) return;
    el.createEl("h3", { text: "Step 2: Review extracted recipe" });
    el.createEl("p", {
      text: "Edit any fields that need correction before saving.",
      cls: "setting-item-description",
    });

    const recipe = this.parsedRecipe;

    new Setting(el).setName("Name").addText((text) => {
      text.setValue(recipe.name).onChange((v) => (recipe.name = v));
      text.inputEl.style.width = "100%";
    });

    new Setting(el).setName("Author").addText((text) => {
      text.setValue(recipe.author).onChange((v) => (recipe.author = v));
      text.inputEl.style.width = "100%";
    });

    new Setting(el).setName("Total time").addText((text) => {
      text.setValue(recipe.totalTime).onChange((v) => (recipe.totalTime = v));
      text.inputEl.style.width = "100%";
    });

    new Setting(el)
      .setName("Ingredients (one per line)")
      .addTextArea((text) => {
        text
          .setValue(recipe.recipeIngredient.join("\n"))
          .onChange(
            (v) =>
              (recipe.recipeIngredient = v.split("\n").filter((l) => l.trim())),
          );
        text.inputEl.style.width = "100%";
        text.inputEl.rows = 8;
      });

    new Setting(el)
      .setName("Instructions (one step per line)")
      .addTextArea((text) => {
        text
          .setValue(recipe.recipeInstructions.join("\n"))
          .onChange(
            (v) =>
              (recipe.recipeInstructions = v
                .split("\n")
                .filter((l) => l.trim())),
          );
        text.inputEl.style.width = "100%";
        text.inputEl.rows = 8;
      });

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText("← Back").onClick(() => {
          this.step = 1;
          this.renderStep();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Next →")
          .setCta()
          .onClick(() => {
            this.step = 3;
            this.renderStep();
          }),
      );
  }

  /* -------------------- Step 3 — Image options ----------------------------- */

  private renderStepImage(el: HTMLElement) {
    el.createEl("h3", { text: "Step 3: Recipe image" });

    new Setting(el)
      .setName("Image option")
      .setDesc("Choose how to set the recipe image.")
      .addDropdown((drop) => {
        drop.addOption("none", "No image");
        drop.addOption("use", "Use the scanned photo");
        drop.addOption("different", "Upload a different food photo");
        drop.setValue(this.imageOption);
        drop.onChange((v) => {
          this.imageOption = v as ImageOption;
          this.renderStep();
        });
      });

    if (this.imageOption === "different") {
      new Setting(el).setName("Food photo").addButton((btn) =>
        btn.setButtonText("Choose image…").onClick(() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/jpeg,image/png,image/webp,image/heic";
          input.onchange = () => {
            const file = input.files?.[0];
            if (file) {
              this.differentImageFile = file;
              this.renderStep();
            }
          };
          input.click();
        }),
      );
      if (this.differentImageFile) {
        el.createEl("p", {
          text: `Selected: ${this.differentImageFile.name}`,
          cls: "setting-item-description",
        });
      }
    }

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText("← Back").onClick(() => {
          this.step = 2;
          this.renderStep();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save Recipe")
          .setCta()
          .onClick(() => {
            if (!this.parsedRecipe) return;
            this.close();
            this.onSubmit({
              recipe: this.parsedRecipe,
              imageOption: this.imageOption,
              originalImageFile:
                this.imageOption === "use" && this.imageFile
                  ? this.imageFile
                  : undefined,
              differentImageFile:
                this.imageOption === "different" && this.differentImageFile
                  ? this.differentImageFile
                  : undefined,
            });
          }),
      );
  }
}
