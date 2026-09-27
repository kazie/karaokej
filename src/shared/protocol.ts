/** Types shared by the server and the browser clients. */

export interface Song {
  id: string
  title: string
  artist: string
  album: string
  /** Top-level library folder, e.g. `Anime`. */
  category: string
  /** Path relative to the library root. */
  path: string
}

export interface QueueItem {
  id: string
  song: Song
  singer?: string
  addedAt: number
  /** Show the bouncing ball for this song (the singer's choice). */
  ball: boolean
}

/** Something the screen device should do to playback; `seq` increases so each is applied once. */
export type PlaybackRequest =
  | { seq: number; kind: 'restart' }
  | { seq: number; kind: 'seekBy'; deltaMs: number }
  /** Jump to the countdown before the next line, if in an instrumental gap. */
  | { seq: number; kind: 'skipGap' }

/** `Omit` for each member of a union separately. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A request before the session numbers it. */
export type NewPlaybackRequest = DistributiveOmit<PlaybackRequest, 'seq'>

export interface SessionSettings {
  /** Skip long intros and interludes automatically, to the countdown. */
  autoSkipInterludes: boolean
}

/** Playback speeds offered on the remote. */
export const SPEED_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2] as const
export type SpeedStep = (typeof SPEED_STEPS)[number]

/** Step of the remote's rewind / fast-forward buttons. */
export const SEEK_STEP_MS = 10_000

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface ScanStatus {
  running: boolean
  done: number
  total: number
  songCount: number
  lastFinishedAt: number | null
  lastError: string | null
}

export interface SessionState {
  queue: QueueItem[]
  current: QueueItem | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  /** The latest playback request for the screen device (restart, seek, skip). */
  request: PlaybackRequest | null
  /** Current song's playback speed; resets to 1 for each song. */
  playbackRate: number
  /** Whether the screen is in an interlude that can be skipped. */
  skippable: boolean
  settings: SessionSettings
  screens: number
  lastError: string | null
  scan: ScanStatus
}

export type ClientRole = 'screen' | 'remote'

/** Commands any client (typically a phone) may send. */
export type RemoteCommand =
  | { type: 'hello'; role: ClientRole }
  /** Liveness check; the server answers with `pong`. */
  | { type: 'ping' }
  | { type: 'enqueue'; songId: string; singer?: string; ball?: boolean }
  | { type: 'remove'; itemId: string }
  | { type: 'move'; itemId: string; toIndex: number }
  | { type: 'playNow'; itemId: string }
  | { type: 'skip' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'seekBy'; deltaMs: number }
  | { type: 'skipInterlude' }
  | { type: 'setSpeed'; rate: number }
  | { type: 'setAutoSkip'; enabled: boolean }
  | { type: 'setBall'; itemId: string; enabled: boolean }

/** Playback reports only screens may send. */
export type ScreenCommand =
  /** `durationMs` is 0 when the length is unknown. */
  | { type: 'loaded'; itemId: string; durationMs: number }
  /** `skippable`: in an intro or interlude that "Skip to next verse" can jump over. */
  | { type: 'progress'; itemId: string; positionMs: number; skippable?: boolean }
  | { type: 'ended'; itemId: string }
  | { type: 'failed'; itemId: string; message: string }

export const SCREEN_COMMANDS: ReadonlySet<ClientCommand['type']> = new Set([
  'loaded',
  'progress',
  'ended',
  'failed',
] satisfies ScreenCommand['type'][])

/** Messages a client sends over the WebSocket. */
export type ClientCommand = RemoteCommand | ScreenCommand

/** Messages the server sends over the WebSocket. */
export type ServerMessage =
  { type: 'state'; state: SessionState } | { type: 'error'; message: string } | { type: 'pong' }

export interface SongPage {
  songs: Song[]
  total: number
  offset: number
  limit: number
}

export interface CategoryCount {
  category: string
  count: number
}

export interface ServerInfo {
  /** Configured public URL, or null to derive one from the LAN addresses. */
  publicUrl: string | null
  /** LAN IPv4 addresses, for building a phone-reachable URL. */
  lanAddresses: string[]
  songCount: number
  scan: ScanStatus
}

export const WS_PATH = '/ws'

export const MAX_SINGER_LENGTH = 40
