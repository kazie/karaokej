/**
 * Ordered schema migrations. Never edit a released migration; append a new one.
 * The index in this array + 1 is the schema version stored in `PRAGMA user_version`.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1: song catalog with full-text search */ `
  CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    error TEXT
  );
  CREATE INDEX songs_by_name ON songs (artist COLLATE NOCASE, title COLLATE NOCASE);
  CREATE INDEX songs_by_category ON songs (category, artist COLLATE NOCASE, title COLLATE NOCASE);

  CREATE VIRTUAL TABLE songs_fts USING fts5(
    title, artist, album, path,
    content = 'songs',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER songs_ai AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts (rowid, title, artist, album, path)
    VALUES (new.rowid, new.title, new.artist, new.album, new.path);
  END;
  CREATE TRIGGER songs_ad AFTER DELETE ON songs BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, artist, album, path)
    VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.path);
  END;
  CREATE TRIGGER songs_au AFTER UPDATE ON songs BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, artist, album, path)
    VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.path);
    INSERT INTO songs_fts (rowid, title, artist, album, path)
    VALUES (new.rowid, new.title, new.artist, new.album, new.path);
  END;
  `,
  /* 2: session settings, one JSON value per key */ `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* 3: second-level folder, backfilled from the path */ `
  ALTER TABLE songs ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';
  -- Only nested songs change; the rest keep the default ''. Same rule as folderOf in src/shared/folders.ts.
  UPDATE songs
    SET subcategory = (SELECT substr(rest, 1, instr(rest, '/') - 1) FROM (SELECT substr(path, instr(path, '/') + 1) AS rest))
    WHERE path GLOB '*/*/*';
  CREATE INDEX songs_by_subcategory
    ON songs (category, subcategory, artist COLLATE NOCASE, title COLLATE NOCASE);
  `,
]
