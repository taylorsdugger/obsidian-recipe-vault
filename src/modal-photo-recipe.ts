import { App, Modal, Notice, Setting } from "obsidian";
import type { RecipeFromImageResult } from "./utils/openrouter";

/** What the modal hands back to main.ts once the user saves. */
export interface PhotoRecipeSubmission {
  /** The (possibly user-edited) transcription result. */
  result: RecipeFromImageResult;
  /** The photo to attach as the recipe's image, if the user kept one. */
  imageBlob?: Blob;
}

type ImageChoice = "captured" | "different" | "none";

interface Capture {
  /** Saveable image bytes — transcoded to JPEG when the source is HEIC/HEIF. */
  blob: Blob;
  /** Base64 data URL sent to the vision model. */
  dataUrl: string;
  /** Object URL for the in-modal thumbnail; revoked on close. */
  previewUrl: string;
}

/**
 * Three-step "Add recipe from photo" flow:
 *   1. Capture — pick/photograph one or more pages of a recipe.
 *   2. Verify — run the injected `onExtract`, then edit the transcription.
 *   3. Photo   — choose which image (if any) to attach to the note.
 *
 * Network/key/model concerns live in main.ts; the modal only knows how to turn
 * images into an editable recipe via `onExtract` (mirrors RefineRecipeModal).
 */
export class PhotoRecipeModal extends Modal {
  private readonly onExtract: (
    images: string[],
  ) => Promise<RecipeFromImageResult>;
  private readonly onSubmit: (submission: PhotoRecipeSubmission) => void;

  private step: 1 | 2 | 3 = 1;
  private extracting = false;

  private captures: Capture[] = [];
  private result: RecipeFromImageResult | null = null;

  private imageChoice: ImageChoice = "captured";
  private differentImage: { file: File; previewUrl: string } | null = null;

  constructor(
    app: App,
    onExtract: (images: string[]) => Promise<RecipeFromImageResult>,
    onSubmit: (submission: PhotoRecipeSubmission) => void,
  ) {
    super(app);
    this.onExtract = onExtract;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.revokePreviews();
  }

  private revokePreviews(): void {
    for (const capture of this.captures) {
      URL.revokeObjectURL(capture.previewUrl);
    }
    if (this.differentImage) {
      URL.revokeObjectURL(this.differentImage.previewUrl);
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    switch (this.step) {
      case 1:
        this.renderCapture(contentEl);
        break;
      case 2:
        this.renderVerify(contentEl);
        break;
      case 3:
        this.renderImage(contentEl);
        break;
    }
  }

  /* ------------------------- Step 1 — Capture ------------------------- */

  private renderCapture(el: HTMLElement): void {
    el.createEl("h3", { text: "Add recipe from photo" });
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Photograph or choose one or more pages of a recipe. Multiple photos are treated as pages of a single recipe.",
    });

    new Setting(el).setName("Recipe photos").addButton((btn) =>
      btn
        .setButtonText(this.captures.length ? "Add more…" : "Choose photos…")
        .setCta()
        .onClick(() => this.pickImages()),
    );

    if (this.captures.length) {
      const grid = el.createDiv({ cls: "photo-recipe-thumbs" });
      this.captures.forEach((capture, index) => {
        const cell = grid.createDiv({ cls: "photo-recipe-thumb" });
        cell.createEl("img", {
          cls: "photo-recipe-thumb-img",
          attr: { src: capture.previewUrl, alt: `Page ${index + 1}` },
        });
        const remove = cell.createEl("button", {
          cls: "photo-recipe-thumb-remove",
          text: "✕",
          attr: { "aria-label": `Remove page ${index + 1}` },
        });
        remove.addEventListener("click", () => {
          URL.revokeObjectURL(capture.previewUrl);
          this.captures.splice(index, 1);
          this.render();
        });
      });
    }

    new Setting(el).addButton((btn) =>
      btn
        .setButtonText("Extract recipe")
        .setCta()
        .setDisabled(this.captures.length === 0 || this.extracting)
        .onClick(() => void this.extract()),
    );
  }

  private pickImages(): void {
    const input = createEl("input", {
      attr: { type: "file", accept: "image/*", multiple: "" },
    });
    // Intentionally no `capture` attribute: on mobile it forces the camera and
    // makes the OS ignore `multiple` and the photo library, which would break
    // both picking existing cookbook photos and the multi-page flow. The native
    // picker still offers "Take Photo" as an option.
    input.addEventListener("change", () => {
      void this.addFiles(Array.from(input.files ?? []));
    });
    input.click();
  }

  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const prepared = await this.prepareImage(file);
      if (!prepared) continue;
      this.captures.push({
        blob: prepared.blob,
        dataUrl: prepared.dataUrl,
        previewUrl: URL.createObjectURL(prepared.blob),
      });
    }
    this.render();
  }

  /**
   * Normalizes a picked image for both the vision call and the saved
   * attachment. iOS captures HEIC/HEIF by default, which most vision models
   * reject and the vault's image-type detector can't save — those are
   * transcoded to JPEG. Web-friendly formats pass through untouched. Returns
   * null (after notifying) when the image can't be read or transcoded.
   */
  private async prepareImage(
    file: File,
  ): Promise<{ blob: Blob; dataUrl: string } | null> {
    try {
      const blob = /hei[cf]/i.test(file.type)
        ? await this.transcodeToJpeg(file)
        : file;
      return { blob, dataUrl: await this.blobToDataUrl(blob) };
    } catch (err) {
      console.error("Recipe Vault: failed to read image", err);
      new Notice(
        `Couldn't process ${file.name}. If it's a HEIC photo, convert it to JPEG and try again.`,
        8000,
      );
      return null;
    }
  }

  /** Decode `file` and re-encode it as a JPEG Blob via a canvas. */
  private async transcodeToJpeg(file: File): Promise<Blob> {
    if (typeof createImageBitmap !== "function") {
      throw new Error("Image decoding is unavailable in this environment.");
    }
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = createEl("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("JPEG encoding failed.");
      return blob;
    } finally {
      bitmap.close();
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(reader.error ?? new Error("Failed to read image file."));
      reader.readAsDataURL(blob);
    });
  }

  private async extract(): Promise<void> {
    if (!this.captures.length || this.extracting) return;
    this.extracting = true;
    const notice = new Notice("Reading recipe from photo…", 0);
    try {
      const result = await this.onExtract(
        this.captures.map((capture) => capture.dataUrl),
      );
      this.result = result;
      this.step = 2;
      this.render();
    } catch (err) {
      console.error("Recipe Vault: photo extraction failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Photo import failed: ${msg}`, 10000);
    } finally {
      this.extracting = false;
      notice.hide();
    }
  }

  /* -------------------------- Step 2 — Verify ------------------------- */

  private renderVerify(el: HTMLElement): void {
    const result = this.result;
    if (!result) return;

    el.createEl("h3", { text: "Review the recipe" });
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Fix any misreads before saving. One ingredient or step per line.",
    });

    new Setting(el).setName("Name").addText((text) => {
      text.setValue(result.name).onChange((v) => (result.name = v));
      text.inputEl.addClass("recipe-vault-input-full");
    });

    new Setting(el)
      .setName("Ingredients")
      .setDesc("One per line.")
      .addTextArea((text) => {
        text
          .setValue(result.recipeIngredient.join("\n"))
          .onChange((v) => (result.recipeIngredient = splitLines(v)));
        text.inputEl.addClass("recipe-vault-input-full");
        text.inputEl.rows = 8;
      });

    new Setting(el)
      .setName("Instructions")
      .setDesc("One step per line.")
      .addTextArea((text) => {
        text
          .setValue(result.recipeInstructions.join("\n"))
          .onChange((v) => (result.recipeInstructions = splitLines(v)));
        text.inputEl.addClass("recipe-vault-input-full");
        text.inputEl.rows = 8;
      });

    new Setting(el).setName("Total time").addText((text) => {
      text.setValue(result.totalTime).onChange((v) => (result.totalTime = v));
      text.inputEl.addClass("recipe-vault-input-full");
    });

    new Setting(el).setName("Yield").addText((text) => {
      text
        .setValue(result.recipeYield)
        .onChange((v) => (result.recipeYield = v));
      text.inputEl.addClass("recipe-vault-input-full");
    });

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText("← Back").onClick(() => {
          this.step = 1;
          this.render();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Next →")
          .setCta()
          .onClick(() => {
            // Validate live here rather than via setDisabled: the textarea
            // onChange handlers mutate `result` in place without re-rendering,
            // so a disabled state computed at render time goes stale the moment
            // the user edits a line.
            if (
              result.recipeIngredient.length === 0 ||
              result.recipeInstructions.length === 0
            ) {
              new Notice(
                "Add at least one ingredient and one step before continuing.",
              );
              return;
            }
            this.step = 3;
            this.render();
          }),
      );
  }

  /* --------------------------- Step 3 — Image ------------------------- */

  private renderImage(el: HTMLElement): void {
    el.createEl("h3", { text: "Recipe image" });

    new Setting(el)
      .setName("Attach a photo")
      .setDesc("The first captured photo is attached by default.")
      .addDropdown((drop) => {
        drop.addOption("captured", "Use the first captured photo");
        drop.addOption("different", "Upload a different photo");
        drop.addOption("none", "No image");
        drop.setValue(this.imageChoice);
        drop.onChange((v) => {
          this.imageChoice = v as ImageChoice;
          this.render();
        });
      });

    if (this.imageChoice === "captured" && this.captures[0]) {
      el.createEl("img", {
        cls: "photo-recipe-preview",
        attr: { src: this.captures[0].previewUrl, alt: "Recipe photo" },
      });
    }

    if (this.imageChoice === "different") {
      new Setting(el).setName("Food photo").addButton((btn) =>
        btn.setButtonText("Choose image…").onClick(() => {
          const input = createEl("input", {
            attr: { type: "file", accept: "image/*" },
          });
          input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) return;
            if (this.differentImage) {
              URL.revokeObjectURL(this.differentImage.previewUrl);
            }
            this.differentImage = {
              file,
              previewUrl: URL.createObjectURL(file),
            };
            this.render();
          });
          input.click();
        }),
      );
      if (this.differentImage) {
        el.createEl("img", {
          cls: "photo-recipe-preview",
          attr: { src: this.differentImage.previewUrl, alt: "Recipe photo" },
        });
      }
    }

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText("← Back").onClick(() => {
          this.step = 2;
          this.render();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save recipe")
          .setCta()
          .onClick(() => this.submit()),
      );
  }

  private submit(): void {
    if (!this.result) return;
    let imageBlob: Blob | undefined;
    if (this.imageChoice === "captured") {
      imageBlob = this.captures[0]?.blob;
    } else if (this.imageChoice === "different") {
      imageBlob = this.differentImage?.file;
    }
    this.close();
    this.onSubmit({ result: this.result, imageBlob });
  }
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
