import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate, openDb, schemaVersion } from '../../server/db/database'
import { MIGRATIONS } from '../../server/db/migrations'

describe('migrations', () => {
  it('migrates an empty database to the latest version', () => {
    const db = openDb(':memory:')
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'songs_fts'").get()).toBeTruthy()
  })

  it('backfills the subfolder of songs indexed before migration 3', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, MIGRATIONS.slice(0, 2))
    const insert = db.prepare(
      `INSERT INTO songs (id, path, category, title, artist, album, size, mtime_ms, indexed_at)
       VALUES (?, ?, '', '', '', '', 1, 1, 1)`,
    )
    const paths = ['root.kfn', 'Anime/x.kfn', 'Anime/Ghibli/x.kfn', 'Anime/Ghibli/Movies/x.kfn']
    paths.forEach((path, i) => insert.run(`s${i}`, path))
    migrate(db)
    const rows = db.prepare('SELECT id, subcategory FROM songs ORDER BY id').all()
    expect(rows.map((r) => r.subcategory)).toEqual(['', '', 'Ghibli', 'Ghibli'])
  })

  it('applies only pending migrations', () => {
    const db = new DatabaseSync(':memory:')
    const steps = ['CREATE TABLE a (x)', 'CREATE TABLE b (x)']
    expect(migrate(db, steps.slice(0, 1))).toBe(1)
    expect(migrate(db, steps)).toBe(2)
    expect(migrate(db, steps)).toBe(2)
    expect(schemaVersion(db)).toBe(2)
  })

  it('rolls back a failing migration', () => {
    const db = new DatabaseSync(':memory:')
    expect(() =>
      migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x); SELECT nope FROM nothing']),
    ).toThrow()
    expect(schemaVersion(db)).toBe(1)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined()
  })

  it('refuses a database from a newer app version', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA user_version = 99')
    expect(() => migrate(db)).toThrow(/newer/)
  })
})
