import { defineConfig } from "drizzle-kit";

/**
 * Drizzle generates SQL into `migrations/`, which is also the directory
 * `wrangler d1 migrations apply` reads. One place for schema changes.
 */
export default defineConfig({
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
});
