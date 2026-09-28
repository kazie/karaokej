import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db/database'
import { SettingsRepository } from '../../server/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/session'

describe('SettingsRepository', () => {
  it('loads the defaults from an empty database', () => {
    expect(new SettingsRepository(openDb(':memory:')).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('loads what it saved', () => {
    const repo = new SettingsRepository(openDb(':memory:'))
    const settings = { autoSkipInterludes: true, leadInMs: 0, highlight: 'instant' } as const
    repo.save(settings)
    repo.save(settings) // overwrites, no duplicate keys
    expect(repo.load()).toEqual(settings)
  })

  it('ignores unknown keys and invalid values', () => {
    const db = openDb(':memory:')
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    insert.run('autoSkipInterludes', '"yes"')
    insert.run('leadInMs', '1900')
    insert.run('highlight', 'not json')
    insert.run('removedSetting', 'true')
    expect(new SettingsRepository(db).load()).toEqual({ ...DEFAULT_SETTINGS, leadInMs: 2000 })
  })
})
