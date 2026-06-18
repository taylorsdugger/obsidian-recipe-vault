/**
 * Runtime stub for the `obsidian` module.
 *
 * The real `obsidian` package ships only `.d.ts` files (its package.json has
 * `"main": ""`) — the implementation is injected by the Obsidian app at
 * runtime and is unavailable under Node/Vitest. This stub supplies just enough
 * of the surface that `src/main.ts` (and the modules it statically imports)
 * reference when the module graph loads, plus a swappable `requestUrl` so tests
 * can drive `RecipeVault.fetchRecipes` deterministically.
 *
 * Only behaviour the parser actually exercises is implemented; everything else
 * is a no-op so subclass definitions and constructions don't blow up.
 */

export interface RequestUrlResponse {
  status: number;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
  json: unknown;
}

type RequestUrlImpl = (
  options: any,
) => Promise<RequestUrlResponse> | RequestUrlResponse;

const notConfigured: RequestUrlImpl = () => {
  throw new Error(
    "requestUrl was called but no implementation is configured — " +
      "use setRequestUrl(...) in your test.",
  );
};

let requestUrlImpl: RequestUrlImpl = notConfigured;

/** All `new Notice(message)` strings, in order, for assertions. */
export const noticeLog: string[] = [];

/** Configure what the next `requestUrl` call(s) resolve to / throw. */
export function setRequestUrl(impl: RequestUrlImpl): void {
  requestUrlImpl = impl;
}

/** Reset network impl and captured notices between tests. */
export function resetObsidianStub(): void {
  requestUrlImpl = notConfigured;
  noticeLog.length = 0;
}

export async function requestUrl(options: any): Promise<RequestUrlResponse> {
  return requestUrlImpl(options);
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export class Notice {
  constructor(message?: string | DocumentFragment) {
    if (typeof message === "string") noticeLog.push(message);
  }
  setMessage(): this {
    return this;
  }
  hide(): void {}
}

export class Plugin {
  app: any;
  manifest: any;
  constructor(app?: any, manifest?: any) {
    this.app = app;
    this.manifest = manifest;
  }
  addRibbonIcon(): any {
    return {};
  }
  addCommand(): any {
    return {};
  }
  addSettingTab(): void {}
  registerView(): void {}
  registerEvent(): void {}
  registerMarkdownPostProcessor(): any {
    return {};
  }
  registerDomEvent(): void {}
  registerInterval(): number {
    return 0;
  }
  loadData(): Promise<any> {
    return Promise.resolve({});
  }
  saveData(): Promise<void> {
    return Promise.resolve();
  }
}

export class Modal {
  app: any;
  contentEl: any = {};
  constructor(app?: any) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Setting {
  constructor(_containerEl?: any) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addTextArea(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  addButton(): this {
    return this;
  }
  addExtraButton(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addSearch(): this {
    return this;
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any = {};
  constructor(app?: any, plugin?: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class FuzzySuggestModal<T> {
  app: any;
  constructor(app?: any) {
    this.app = app;
  }
  setPlaceholder(): this {
    return this;
  }
  open(): void {}
  close(): void {}
  getItems(): T[] {
    return [];
  }
}

export class ItemView {
  leaf: any;
  containerEl: any = { children: [{}, {}] };
  constructor(leaf?: any) {
    this.leaf = leaf;
  }
}

export class WorkspaceLeaf {}
export class App {}
export class MarkdownView {}
export class MarkdownPostProcessorContext {}
export class Vault {}
export class MetadataCache {}
export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
}
export class TFolder {
  path = "";
  name = "";
  children: any[] = [];
}
