import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import {
  WS_PATH,
  type ClientCommand,
  type ClientRole,
  type ScreenCommand,
  type ServerMessage,
  type SessionState,
} from '../shared/protocol'

const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 5_000
/** Give up on a connection attempt that hangs (flaky Wi-Fi) and retry. */
const CONNECT_TIMEOUT_MS = 5_000
/** Check that an open socket is really alive; a sleeping phone's socket can die silently. */
const PING_INTERVAL_MS = 15_000
const PONG_TIMEOUT_MS = 5_000
/** After being hidden this long, don't trust the old socket. */
const STALE_AFTER_HIDDEN_MS = 10_000

/** Pending screen reports are keyed so only the latest per song and kind is kept. */
function reportKey(report: ScreenCommand): string {
  return report.type === 'progress' ? 'progress' : `${report.type}:${report.itemId}`
}

/** Whether the server's state shows that a report no longer needs (re)sending. */
function reportSettled(report: ScreenCommand, state: SessionState): boolean {
  if (state.current?.id !== report.itemId) return true
  if (report.type === 'loaded') return state.status !== 'loading'
  return false
}

/**
 * Live connection to the shared karaoke session. Reconnects automatically,
 * immediately when the page becomes visible again or the network returns
 * (phones sleep between songs), and detects silently dead sockets.
 */
export function useSession(role: ClientRole) {
  const state = shallowRef<SessionState | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)

  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let backoff = INITIAL_BACKOFF_MS
  let hiddenAt: number | null = null
  let disposed = false
  /** Screen reports not yet confirmed by the server's state; re-sent after reconnecting. */
  const pending = new Map<string, ScreenCommand>()

  function clearTimers(): void {
    clearTimeout(retryTimer)
    clearTimeout(connectTimer)
    clearInterval(pingTimer)
    clearTimeout(pongTimer)
  }

  function rawSend(command: ClientCommand): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(command))
    return true
  }

  function flushPending(): void {
    for (const [key, report] of pending) {
      // Progress is fire-and-forget: only the latest value while offline matters.
      if (rawSend(report) && report.type === 'progress') pending.delete(key)
    }
  }

  function scheduleRetry(): void {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }

  /** Drop the current socket without triggering the automatic retry. */
  function abandon(ws: WebSocket | null): void {
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    ws.close()
  }

  function onDead(ws: WebSocket): void {
    if (socket !== ws) return
    clearTimers()
    abandon(ws)
    socket = null
    connected.value = false
    if (!disposed) scheduleRetry()
  }

  function connect(): void {
    clearTimers()
    abandon(socket)
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`
    const ws = new WebSocket(url)
    socket = ws
    connectTimer = setTimeout(() => onDead(ws), CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      clearTimeout(connectTimer)
      connected.value = true
      backoff = INITIAL_BACKOFF_MS
      rawSend({ type: 'hello', role })
      flushPending()
      pingTimer = setInterval(() => {
        if (!rawSend({ type: 'ping' })) return
        clearTimeout(pongTimer)
        pongTimer = setTimeout(() => onDead(ws), PONG_TIMEOUT_MS)
      }, PING_INTERVAL_MS)
    }
    ws.onmessage = (event) => {
      clearTimeout(pongTimer) // any message proves the connection is alive
      const message = JSON.parse(String(event.data)) as ServerMessage
      if (message.type === 'state') {
        state.value = message.state
        for (const [key, report] of pending) {
          if (reportSettled(report, message.state)) pending.delete(key)
        }
      } else if (message.type === 'error') {
        error.value = message.message
      }
    }
    ws.onclose = () => onDead(ws)
  }

  /** Reconnect right away (e.g. after waking up), skipping any backoff. */
  function reconnectNow(): void {
    if (disposed) return
    backoff = INITIAL_BACKOFF_MS
    connect()
  }

  /** Send now if connected; returns false otherwise. Not retried: stale commands could act on the wrong song. */
  function send(command: ClientCommand): boolean {
    return rawSend(command)
  }

  /** Screen playback reports: kept until the server's state confirms them, re-sent after reconnecting. */
  function report(command: ScreenCommand): void {
    pending.set(reportKey(command), command)
    if (rawSend(command) && command.type === 'progress') pending.delete('progress')
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    const wasAsleep = hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS
    hiddenAt = null
    if (wasAsleep || socket?.readyState !== WebSocket.OPEN) reconnectNow()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', reconnectNow)
  connect()

  onScopeDispose(() => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', reconnectNow)
    clearTimers()
    abandon(socket)
    socket = null
  })

  return { state, connected: readonly(connected), error, send, report, reconnectNow }
}
