CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY NOT NULL,
  revision TEXT NOT NULL,
  active INTEGER NOT NULL,
  details TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_imports (
  name TEXT PRIMARY KEY NOT NULL
);
