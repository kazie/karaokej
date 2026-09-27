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
