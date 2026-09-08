/** Bindings and secrets from wrangler.toml / .dev.vars. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** PBKDF2 hash of the household password. See scripts/hash-password.mjs. */
  AUTH_PASSWORD_HASH: string;
  /** Signs the session cookie. Rotating it signs every device out. */
  AUTH_COOKIE_SECRET: string;
}

/** The Hono generic every route in this app uses. */
export type AppBindings = { Bindings: Env };
