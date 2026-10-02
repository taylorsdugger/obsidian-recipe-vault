-- A public link to one recipe. The token is the whole secret, so it's long and
-- random rather than the recipe id. One link per recipe: turning it off deletes
-- the row, and turning it back on makes a new token, so an old link stays dead.
-- Deleting the recipe takes its link with it.
CREATE TABLE recipe_shares (
  token TEXT PRIMARY KEY NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX recipe_shares_recipe_idx ON recipe_shares (recipe_id);
