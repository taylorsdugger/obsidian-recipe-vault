import { App, Modal, Notice, Setting } from "obsidian";
import { recognizeText, parseRecipeText, ParsedRecipe } from "./ocr-parser";

export type ImageOption = "use" | "different" | "none";

export interface ImageRecipeResult {
  recipe: ParsedRecipe;
  imageOption: ImageOption;
  /** The original uploaded image file (step 1). Available when imageOption is "use". */
  originalImageFile?: File;
  /** A separately chosen food photo. Available when imageOption is "different". */
  differentImageFile?: File;
}

export class ImageRecipeModal extends Modal {
  private onSubmit: (result: ImageRecipeResult) => void;

  private step = 1;
  private imageFile: File | null = null;
  private imagePreviewUrl: string | null = null;
  private parsedRecipe: ParsedRecipe | null = null;
  private imageOption: ImageOption = "none";
  private differentImageFile: File | null = null;

  constructor(app: App, onSubmit: (result: ImageRecipeResult) => void) {
    super(app);
    this.onSubmit = onSubmit;
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
            const text = await recognizeText(
              this.imagePreviewUrl,
              (progress) => {
                notice.setMessage(
                  `Scanning recipe… ${Math.round(progress * 100)}%`,
                );
              },
            );
            notice.hide();
            this.parsedRecipe = parseRecipeText(text);
            this.step = 2;
            this.renderStep();
          } catch (err) {
            notice.hide();
            new Notice("OCR failed — please try a clearer image.");
            console.error("Recipe OCR error:", err);
          }
        }),
    );
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
