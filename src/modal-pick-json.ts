import { App, FuzzySuggestModal, TFile } from "obsidian";

/** True for the file extensions the JSON-LD importer will read. */
export function isJsonLdFile(file: TFile): boolean {
  const ext = file.extension.toLowerCase();
  return ext === "json" || ext === "jsonld";
}

/**
 * Pick one `.json` / `.jsonld` file out of the vault.
 *
 * Obsidian can't open a JSON file in an editor, so there's no "active file" to
 * act on the way the export command has one. This is how the command palette
 * reaches a file that only exists in the file explorer.
 */
export class PickJsonFileModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Pick a JSON-LD recipe file");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter(isJsonLdFile)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
