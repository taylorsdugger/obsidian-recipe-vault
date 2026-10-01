-- App settings, one row per key. Just the save format for new recipes so far:
-- the web app's own "save new recipes as", kept apart from the plugin's.
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
