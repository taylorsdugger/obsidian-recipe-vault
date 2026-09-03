-- Initial schema. See src/worker/db/schema.ts for the Drizzle definitions.

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  author TEXT,
  source_url TEXT,
  photo_url TEXT,
  meal_type TEXT,
  cook_time TEXT,
  cook_time_mins INTEGER,
  ingredients TEXT NOT NULL DEFAULT '[]',
  times_made INTEGER NOT NULL DEFAULT 0,
  last_made TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX recipes_title_idx ON recipes (title);

CREATE TABLE plan_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'dinner',
  recipe_id TEXT REFERENCES recipes (id) ON DELETE CASCADE,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX plan_entries_date_idx ON plan_entries (date);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '[]',
  original TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
