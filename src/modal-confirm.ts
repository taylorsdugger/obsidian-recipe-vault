import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
}

/** A yes/no question. Nothing happens unless the confirm button is pressed. */
export class ConfirmModal extends Modal {
  private readonly options: ConfirmModalOptions;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(this.options.title);
    contentEl.createEl("p", { text: this.options.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.options.confirmText)
          .setCta()
          .onClick(() => {
            this.close();
            this.options.onConfirm();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
