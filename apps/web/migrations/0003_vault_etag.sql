-- The R2 etag of the note as this app last read it. A write is conditional on
-- it, so the app refuses to overwrite a note that Obsidian changed in the
-- meantime rather than silently winning the race.
ALTER TABLE recipes ADD COLUMN vault_etag TEXT;
