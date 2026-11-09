-- The D1 skeleton (e11-t01): one small table, so that the migration flow and later the backups run
-- for real. The real schema (trips, members, days, stops, places, ...) comes with A3.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_started_at', datetime('now'));
