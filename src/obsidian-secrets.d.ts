// Type augmentation for Obsidian's OS-backed secret storage ("Keychain").
//
// These APIs ship with Obsidian 1.11.4+ (SecretComponent since 1.11.1) but are
// not present in the `obsidian` typings version this repo currently depends on.
// We keep `minAppVersion` low so the plugin still loads (gallery/import) on
// older builds and mobile, and feature-detect `app.secretStorage` at runtime
// before touching anything declared here.
//
// Docs: https://docs.obsidian.md/plugins/guides/secret-storage

import "obsidian";

declare module "obsidian" {
  /**
   * Reads/writes secrets in the OS secure store (macOS Keychain, Windows
   * Credential Manager, Linux libsecret). Available since Obsidian 1.11.4.
   */
  class SecretStorage extends Events {
    /**
     * @param id Lowercase alphanumeric ID with optional dashes.
     * @throws Error if the ID is invalid.
     */
    setSecret(id: string, secret: string): void;
    getSecret(id: string): string | null;
    listSecrets(): string[];
  }

  /**
   * Settings widget that lets the user pick or create a Keychain secret. Its
   * value is the secret's *id*, not the secret itself. Since Obsidian 1.11.1.
   */
  class SecretComponent extends BaseComponent {
    constructor(app: App, containerEl: HTMLElement);
    setValue(value: string): this;
    onChange(cb: (value: string) => unknown): this;
  }

  interface App {
    /** Present only on Obsidian builds that support the Keychain (1.11.4+). */
    secretStorage?: SecretStorage;
  }

  interface Setting {
    addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this;
  }
}
