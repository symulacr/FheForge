-- MC-095: Migration tracking table
-- Tracks which migrations have been applied to the database.
-- Each migration file should be registered here before or during execution.

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Register previously-applied migrations.
-- 001_event_indexing_tables was applied by the legacy runner (MC-55).
INSERT INTO _migrations (filename)
SELECT '001_event_indexing_tables.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE filename = '001_event_indexing_tables.sql'
);
