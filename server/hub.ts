import { randomUUID } from 'node:crypto'
import {
  HIGHLIGHT_MODES,
  MAX_SINGER_LENGTH,
  SCREEN_COMMANDS,
  type ClientCommand,
  type ClientRole,
  type HighlightMode,
  type ScanStatus,
  type ServerMessage,
  type SessionState,
} from '../src/shared/protocol'
import { initialState, reduce, type SessionAction } from '../src/shared/session'
import type { SettingsRepository } from './settings'
import { toSong, type SongRepository } from './songs'

export interface HubClient {
  role: ClientRole
  /** Receives a serialized {@link ServerMessage}. */
  send: (json: string) => void
}

export class CommandError extends Error {}

const serialize = (message: ServerMessage): string => JSON.stringify(message)

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v === '') throw new CommandError(`Missing ${field}`)
  return v
}
const bool = (v: unknown, field: string): boolean => {
  if (typeof v !== 'boolean') throw new CommandError(`Invalid ${field}`)
  return v
}
const num = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CommandError(`Invalid ${field}`)
  return v
}
const highlightMode = (v: unknown, field: string): HighlightMode => {
  if (!HIGHLIGHT_MODES.includes(v as HighlightMode)) throw new CommandError(`Invalid ${field}`)
  return v as HighlightMode
}
/** Validate an optional field: absent is fine, present must pass `check`. */
const optional = <T>(v: unknown, check: (v: unknown, field: string) => T, field: string): T | undefined =>
  v === undefined ? undefined : check(v, field)

/** Validate an untrusted message into a ClientCommand. */
export function parseCommand(raw: string): ClientCommand {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new CommandError('Invalid JSON')
  }
  if (typeof msg !== 'object' || msg === null) throw new CommandError('Invalid message')
  switch (msg.type) {
    case 'hello':
      if (msg.role !== 'screen' && msg.role !== 'remote') throw new CommandError('Invalid role')
      return { type: 'hello', role: msg.role }
    case 'enqueue':
      return {
        type: 'enqueue',
        songId: str(msg.songId, 'songId'),
        singer: typeof msg.singer === 'string' ? msg.singer : undefined,
        ball: optional(msg.ball, bool, 'ball'),
      }
    case 'remove':
    case 'playNow':
    case 'ended':
      return { type: msg.type, itemId: str(msg.itemId, 'itemId') }
    case 'move':
      return { type: 'move', itemId: str(msg.itemId, 'itemId'), toIndex: num(msg.toIndex, 'toIndex') }
    case 'seekBy':
      return { type: 'seekBy', deltaMs: num(msg.deltaMs, 'deltaMs') }
    case 'setSpeed':
      return { type: 'setSpeed', rate: num(msg.rate, 'rate') }
    case 'setAutoSkip':
      return { type: 'setAutoSkip', enabled: bool(msg.enabled, 'enabled') }
    case 'setLeadIn':
      return { type: 'setLeadIn', ms: num(msg.ms, 'ms') }
    case 'setHighlight':
      return { type: 'setHighlight', mode: highlightMode(msg.mode, 'mode') }
    case 'setBall':
      return { type: 'setBall', itemId: str(msg.itemId, 'itemId'), enabled: bool(msg.enabled, 'enabled') }
    case 'ping':
    case 'skipInterlude':
    case 'skip':
    case 'pause':
    case 'resume':
    case 'restart':
      return { type: msg.type }
    case 'loaded':
      return {
        type: 'loaded',
        itemId: str(msg.itemId, 'itemId'),
        durationMs: num(msg.durationMs, 'durationMs'),
      }
    case 'progress':
      return {
        type: 'progress',
        itemId: str(msg.itemId, 'itemId'),
        positionMs: num(msg.positionMs, 'positionMs'),
        skippable: optional(msg.skippable, bool, 'skippable'),
      }
    case 'failed':
      return {
        type: 'failed',
        itemId: str(msg.itemId, 'itemId'),
        message: String(msg.message ?? 'unknown error'),
      }
    default:
      throw new CommandError(`Unknown command ${String(msg.type)}`)
  }
}

/** Owns the shared session and fans state out to every connected client. */
export interface SessionHubOptions {
  /** Where session settings are kept across restarts; in memory only when absent. */
  settings?: SettingsRepository
  newId?: () => string
  now?: () => number
}

export class SessionHub {
  state: SessionState
  private readonly clients = new Set<HubClient>()
  private readonly settings: SettingsRepository | undefined
  private readonly newId: () => string
  private readonly now: () => number

  constructor(
    private readonly songs: SongRepository,
    { settings, newId = randomUUID, now = Date.now }: SessionHubOptions = {},
  ) {
    this.settings = settings
    this.newId = newId
    this.now = now
    this.state = initialState(settings?.load())
  }

  connect(send: HubClient['send']): HubClient {
    const client: HubClient = { role: 'remote', send }
    this.clients.add(client)
    send(serialize({ type: 'state', state: this.state }))
    return client
  }

  disconnect(client: HubClient): void {
    if (this.clients.delete(client) && client.role === 'screen') this.syncScreens()
  }

  handle(client: HubClient, raw: string): void {
    try {
      this.execute(client, parseCommand(raw))
    } catch (e) {
      if (!(e instanceof CommandError)) throw e
      client.send(serialize({ type: 'error', message: e.message }))
    }
  }

  execute(client: HubClient, command: ClientCommand): void {
    if (command.type === 'hello') {
      client.role = command.role
      this.syncScreens()
      return
    }
    if (command.type === 'ping') {
      client.send(serialize({ type: 'pong' }))
      return
    }
    if (SCREEN_COMMANDS.has(command.type) && client.role !== 'screen') {
      throw new CommandError(`Only screens may send ${command.type}`)
    }
    if (command.type === 'enqueue') {
      const row = this.songs.byId(command.songId)
      if (!row) throw new CommandError('Song not found')
      const singer = command.singer?.trim().slice(0, MAX_SINGER_LENGTH) || undefined
      this.dispatch({
        type: 'enqueue',
        item: {
          id: this.newId(),
          song: toSong(row),
          singer,
          addedAt: this.now(),
          ball: command.ball ?? true,
        },
      })
      return
    }
    this.dispatch(command)
  }

  setScan(scan: ScanStatus): void {
    this.dispatch({ type: 'scan', scan })
  }

  dispatch(action: SessionAction): void {
    const next = reduce(this.state, action)
    if (next === this.state) return
    if (next.settings !== this.state.settings) this.settings?.save(next.settings)
    this.state = next
    // Serialize once for all clients.
    const json = serialize({ type: 'state', state: next })
    for (const client of this.clients) client.send(json)
  }

  private syncScreens(): void {
    const count = [...this.clients].filter((c) => c.role === 'screen').length
    if (count !== this.state.screens) this.dispatch({ type: 'screens', count })
  }
}
