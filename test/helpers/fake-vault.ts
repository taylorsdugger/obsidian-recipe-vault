import { readFrontmatter } from "@recipe-vault/core";

import { TFile, TFolder } from "./obsidian-stub";

/**
 * An in-memory vault with just the calls the import paths make: files and
 * folders by path, frontmatter through the metadata cache, and
 * `processFrontMatter` for the keys set after a note is written.
 *
 * Creating a file whose folder doesn't exist throws, like the real vault,
 * so a test catches a missing `folderCheck`.
 */
export class FakeVault {
  readonly root = makeFolder("/", null);
  private readonly contents = new Map<string, string>();
  private readonly byPath = new Map<string, TFile | TFolder>([
    ["/", this.root],
  ]);

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.byPath.get(path === "" ? "/" : path) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.byPath.values()].filter(
      (f): f is TFile => f instanceof TFile && f.extension === "md",
    );
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.byPath.has(path))
      throw new Error(`Folder already exists: ${path}`);
    const parent = this.parentOf(path);
    const folder = makeFolder(path, parent);
    parent.children.push(folder);
    this.byPath.set(path, folder);
    return folder;
  }

  async create(path: string, data: string): Promise<TFile> {
    if (this.byPath.has(path)) throw new Error(`File already exists: ${path}`);
    const parent = this.parentOf(path);
    const name = path.split("/").pop() ?? path;
    const file = new TFile();
    file.path = path;
    file.name = name;
    file.extension = name.includes(".") ? name.split(".").pop()! : "";
    file.basename = file.extension
      ? name.slice(0, -file.extension.length - 1)
      : name;
    file.parent = parent;
    parent.children.push(file);
    this.byPath.set(path, file);
    this.contents.set(path, data);
    return file;
  }

  async read(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async modify(file: TFile, data: string): Promise<void> {
    this.contents.set(file.path, data);
  }

  /** Test helper: make a file, and any folders above it. */
  async seed(path: string, data: string): Promise<TFile> {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!this.byPath.has(dir)) await this.createFolder(dir);
    }
    return this.create(path, data);
  }

  /** Test helper: every file under a folder, by path. */
  paths(prefix = ""): string[] {
    return [...this.byPath.values()]
      .filter((f): f is TFile => f instanceof TFile)
      .map((f) => f.path)
      .filter((p) => p.startsWith(prefix))
      .sort();
  }

  text(path: string): string {
    return this.contents.get(path) ?? "";
  }

  private parentOf(path: string): TFolder {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
    const parent = this.byPath.get(dir);
    if (!(parent instanceof TFolder)) throw new Error(`No folder: ${dir}`);
    return parent;
  }
}

function makeFolder(path: string, parent: TFolder | null): TFolder {
  const folder = new TFolder();
  folder.path = path;
  folder.name = path === "/" ? "" : path.split("/").pop() ?? path;
  folder.parent = parent;
  return folder;
}

/** An `App` around a {@link FakeVault}, enough for the import paths. */
export function makeFakeApp(vault: FakeVault) {
  return {
    vault,
    metadataCache: {
      getFileCache(file: TFile) {
        return { frontmatter: readFrontmatter(vault.text(file.path)) };
      },
    },
    fileManager: {
      // Only ever called to add simple scalar keys, so write them as lines
      // at the end of the frontmatter, replacing a line for the same key.
      async processFrontMatter(
        file: TFile,
        fn: (fm: Record<string, unknown>) => void,
      ) {
        const updates: Record<string, unknown> = {};
        fn(updates);
        let text = vault.text(file.path);
        const end = text.indexOf("\n---", 4);
        let head = text.slice(0, end);
        for (const [key, value] of Object.entries(updates)) {
          const line = `${key}: ${String(value)}`;
          const existing = new RegExp(`^${key}:.*$`, "m");
          head = existing.test(head)
            ? head.replace(existing, line)
            : `${head}\n${line}`;
        }
        text = head + text.slice(end);
        await vault.modify(file, text);
      },
    },
    workspace: {
      async openLinkText() {},
      getLeavesOfType() {
        return [];
      },
    },
  };
}
