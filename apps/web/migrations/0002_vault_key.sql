-- Where a recipe came from in the synced vault, so a re-import updates the
-- row it created last time instead of adding a second copy. Null for recipes
-- imported from a URL in the app.
ALTER TABLE recipes ADD COLUMN vault_key TEXT;

CREATE UNIQUE INDEX recipes_vault_key_idx ON recipes (vault_key);
