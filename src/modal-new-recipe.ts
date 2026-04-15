import { App, Modal, Setting } from "obsidian";

export class NewRecipeModal extends Modal {
  recipeName: string;
  onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.recipeName = "";
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", { text: "Enter a name for your new recipe" });

    new Setting(contentEl).setName("Recipe name").addText((text) => {
      text.setPlaceholder("eg: Grandma's Apple Pie");

      text.onChange((value) => {
        this.recipeName = value;
      });
      text.inputEl.addClass("recipe-vault-input-full");

      // Submit on Enter
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.close();
          this.onSubmit(this.recipeName);
        }
      });
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Create Recipe")
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.recipeName);
        }),
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
