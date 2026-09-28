import { App, FuzzySuggestModal, TFile } from "obsidian";

/** True for the file extensions the JSON-LD importer will read. */
export function isJsonLdFile(file: TFile): boolean {
  const ext = file.extension.toLowerCase();
  return ext === "json" || ext === "jsonld";
}

/** True for a Cooklang recipe file. */
export function isCooklangFile(file: TFile): boolean {
  return file.extension.toLowerCase() === "cook";
}

/** True for any file the "import from file" actions can turn into a note. */
export function isImportableRecipeFile(file: TFile): boolean {
  return isJsonLdFile(file) || isCooklangFile(file);
}

/**
 * Pick one `.json` / `.jsonld` / `.cook` file out of the vault.
 *
 * Obsidian can't open these in an editor, so there's no "active file" to act
 * on the way the export commands have one. This is how the command palette
 * reaches a file that only exists in the file explorer.
 */
export class PickRecipeFileModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Pick a JSON-LD or Cooklang recipe file");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter(isImportableRecipeFile)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
