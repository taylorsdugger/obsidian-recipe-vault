/** Bindings and secrets from wrangler.toml / .dev.vars. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** The synced Obsidian vault. Read-only; the sync plugin owns it. */
  VAULT: R2Bucket;
  /** PBKDF2 hash of the household password. See scripts/hash-password.mjs. */
  AUTH_PASSWORD_HASH: string;
  /** Signs the session cookie. Rotating it signs every device out. */
  AUTH_COOKIE_SECRET: string;
  /** OpenRouter key for Ask AI. Without it Ask AI stays hidden. */
  OPENROUTER_API_KEY?: string;
  /** Which model Ask AI uses. Falls back to the plugin's default. */
  OPENROUTER_MODEL?: string;
}

/** The Hono generic every route in this app uses. */
export type AppBindings = { Bindings: Env };
