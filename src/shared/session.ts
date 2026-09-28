import {
  LEAD_IN_STEPS,
  SPEED_STEPS,
  type LeadInStep,
  type SessionSettings,
  type SpeedStep,
  type ClientCommand,
  type NewPlaybackRequest,
  type PlaybackRequest,
  type QueueItem,
  type ScanStatus,
  type SessionState,
} from './protocol'

/** Reducer actions: client commands, with `enqueue` carrying a resolved queue item, plus server events. */
export type SessionAction =
  | Exclude<ClientCommand, { type: 'hello' | 'ping' | 'enqueue' }>
  | { type: 'enqueue'; item: QueueItem }
  | { type: 'screens'; count: number }
  | { type: 'scan'; scan: ScanStatus }

export const initialScan: ScanStatus = {
  running: false,
  done: 0,
  total: 0,
  songCount: 0,
  lastFinishedAt: null,
  lastError: null,
}

export const DEFAULT_SETTINGS: SessionSettings = {
  autoSkipInterludes: false,
  leadInMs: 3000,
  highlight: 'wipe',
}

export function initialState(settings: SessionSettings = DEFAULT_SETTINGS): SessionState {
  return {
    queue: [],
    current: null,
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    request: null,
    playbackRate: 1,
    skippable: false,
    settings,
    screens: 0,
    lastError: null,
    scan: initialScan,
  }
}

function start(state: SessionState, item: QueueItem | null, queue: QueueItem[]): SessionState {
  return {
    ...state,
    queue,
    current: item,
    status: item ? 'loading' : 'idle',
    positionMs: 0,
    durationMs: 0,
    playbackRate: 1,
    skippable: false,
  }
}

/** Longest single seek accepted, in either direction. */
const MAX_SEEK_MS = 10 * 60_000

/** The nearest offered speed. */
export function snapSpeed(rate: number): SpeedStep {
  return SPEED_STEPS.reduce<SpeedStep>(
    (best, step) => (Math.abs(step - rate) < Math.abs(best - rate) ? step : best),
    1,
  )
}

/** The nearest offered lead-in time. */
export function snapLeadIn(ms: number): LeadInStep {
  return LEAD_IN_STEPS.reduce<LeadInStep>(
    (best, step) => (Math.abs(step - ms) < Math.abs(best - ms) ? step : best),
    DEFAULT_SETTINGS.leadInMs,
  )
}

/** Number a new request after `previous`, so the screen applies each one once. */
export function nextRequest(previous: PlaybackRequest | null, req: NewPlaybackRequest): PlaybackRequest {
  return { ...req, seq: (previous?.seq ?? 0) + 1 }
}

/**
 * Queue a playback request for the screen, if a song is playing or paused.
 * While it loads there is nothing to seek yet, and the screen would not apply it.
 * The screen reports the new position right after applying it.
 */
function request(state: SessionState, req: NewPlaybackRequest): SessionState {
  if (!state.current || state.status === 'loading') return state
  return { ...state, request: nextRequest(state.request, req) }
}

function setBall(item: QueueItem, itemId: string, enabled: boolean): QueueItem {
  return item.id === itemId && item.ball !== enabled ? { ...item, ball: enabled } : item
}

function advance(state: SessionState): SessionState {
  const [next = null, ...rest] = state.queue
  return start(state, next, rest)
}

const isCurrent = (state: SessionState, itemId: string) => state.current?.id === itemId

/** Pure session reducer. Returns the same object when nothing changed. */
export function reduce(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'enqueue': {
      const queue = [...state.queue, action.item]
      return state.current ? { ...state, queue } : advance({ ...state, queue })
    }
    case 'remove': {
      if (isCurrent(state, action.itemId)) return advance(state)
      const queue = state.queue.filter((i) => i.id !== action.itemId)
      return queue.length === state.queue.length ? state : { ...state, queue }
    }
    case 'move': {
      const from = state.queue.findIndex((i) => i.id === action.itemId)
      if (from < 0) return state
      const queue = [...state.queue]
      const [item] = queue.splice(from, 1)
      const to = Math.max(0, Math.min(queue.length, Math.trunc(action.toIndex)))
      queue.splice(to, 0, item!)
      return { ...state, queue }
    }
    case 'playNow': {
      const item = state.queue.find((i) => i.id === action.itemId)
      if (!item) return state
      return start(
        state,
        item,
        state.queue.filter((i) => i !== item),
      )
    }
    case 'skip':
      return state.current ? advance(state) : state
    case 'pause':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state
    case 'resume':
      return state.status === 'paused' ? { ...state, status: 'playing' } : state
    case 'restart':
      return request(state, { kind: 'restart' })
    case 'seekBy':
      return request(state, {
        kind: 'seekBy',
        deltaMs: Math.max(-MAX_SEEK_MS, Math.min(MAX_SEEK_MS, Math.trunc(action.deltaMs))),
      })
    case 'skipInterlude':
      return state.skippable ? request(state, { kind: 'skipGap' }) : state
    case 'setSpeed': {
      if (!state.current) return state
      const playbackRate = snapSpeed(action.rate)
      return playbackRate === state.playbackRate ? state : { ...state, playbackRate }
    }
    case 'setAutoSkip':
      return action.enabled === state.settings.autoSkipInterludes
        ? state
        : { ...state, settings: { ...state.settings, autoSkipInterludes: action.enabled } }
    case 'setLeadIn': {
      const leadInMs = snapLeadIn(action.ms)
      return leadInMs === state.settings.leadInMs
        ? state
        : { ...state, settings: { ...state.settings, leadInMs } }
    }
    case 'setHighlight':
      return action.mode === state.settings.highlight
        ? state
        : { ...state, settings: { ...state.settings, highlight: action.mode } }
    case 'setBall': {
      const current = state.current && setBall(state.current, action.itemId, action.enabled)
      const queue = state.queue.map((i) => setBall(i, action.itemId, action.enabled))
      const changed = current !== state.current || queue.some((i, n) => i !== state.queue[n])
      return changed ? { ...state, current, queue } : state
    }
    case 'loaded':
      if (!isCurrent(state, action.itemId) || state.status !== 'loading') return state
      return { ...state, status: 'playing', durationMs: action.durationMs, lastError: null }
    case 'progress':
      return isCurrent(state, action.itemId)
        ? { ...state, positionMs: action.positionMs, skippable: action.skippable === true }
        : state
    case 'ended':
      return isCurrent(state, action.itemId) ? advance(state) : state
    case 'failed':
      if (!isCurrent(state, action.itemId)) return state
      return {
        ...advance(state),
        lastError: `Could not play ${state.current!.song.title}: ${action.message}`,
      }
    case 'screens':
      return { ...state, screens: action.count }
    case 'scan':
      return { ...state, scan: action.scan }
  }
}
