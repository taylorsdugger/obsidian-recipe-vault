import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/** One Drizzle client per request; D1 bindings are cheap to wrap. */
export function db(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

export { schema };
