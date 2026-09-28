import { HIGHLIGHT_MODES, type HighlightMode, type SessionSettings } from '../src/shared/protocol'
import { DEFAULT_SETTINGS, snapLeadIn } from '../src/shared/session'
import { transaction, type Database } from './db/database'

type Field<K extends keyof SessionSettings> = (v: unknown) => SessionSettings[K] | undefined

/** Checks each stored value; `undefined` falls back to the default. */
const FIELDS: { [K in keyof SessionSettings]: Field<K> } = {
  autoSkipInterludes: (v) => (typeof v === 'boolean' ? v : undefined),
  leadInMs: (v) => (typeof v === 'number' && Number.isFinite(v) ? snapLeadIn(v) : undefined),
  highlight: (v) => (HIGHLIGHT_MODES.includes(v as HighlightMode) ? (v as HighlightMode) : undefined),
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Session settings kept across restarts, one JSON value per key. */
export class SettingsRepository {
  private readonly allStmt
  private readonly upsertStmt

  constructor(private readonly db: Database) {
    this.allStmt = db.prepare('SELECT key, value FROM settings')
    this.upsertStmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
  }

  /** The saved settings over the defaults; unknown keys and invalid values are ignored. */
  load(): SessionSettings {
    const stored = new Map(
      (this.allStmt.all() as { key: string; value: string }[]).map((r) => [r.key, parseJson(r.value)]),
    )
    const pick = <K extends keyof SessionSettings>(key: K): SessionSettings[K] =>
      FIELDS[key](stored.get(key)) ?? DEFAULT_SETTINGS[key]
    return {
      autoSkipInterludes: pick('autoSkipInterludes'),
      leadInMs: pick('leadInMs'),
      highlight: pick('highlight'),
    }
  }

  save(settings: SessionSettings): void {
    transaction(this.db, () => {
      for (const [key, value] of Object.entries(settings)) this.upsertStmt.run(key, JSON.stringify(value))
    })
  }
}
