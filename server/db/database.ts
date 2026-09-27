import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Database = DatabaseSync

export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function schemaVersion(db: Database): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
}

/** Apply pending migrations, each in its own transaction. Returns the new schema version. */
export function migrate(db: Database, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(`Database schema version ${current} is newer than this app (${migrations.length})`)
  }
  for (let version = current; version < migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version]!)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })
  }
  return migrations.length
}

/** Open (creating if needed) and migrate the database. Use `:memory:` in tests. */
export function openDb(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path)
  } catch (e) {
    throw new Error(`Cannot open database ${path} (is its directory writable?)`, { cause: e })
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}
