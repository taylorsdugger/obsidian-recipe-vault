/** Bindings and secrets from wrangler.toml / .dev.vars. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** What you type on the login screen. */
  HOUSEHOLD_PASSCODE: string;
  /** Signs the session cookie. Changing it logs everyone out. */
  HOUSEHOLD_SECRET: string;
}

/** The Hono generic every route in this app uses. */
export type AppBindings = { Bindings: Env };
