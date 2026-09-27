import { effectScope, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/composables/useSession'
import type { ClientCommand, QueueItem, ServerMessage, SessionState } from '../src/shared/protocol'
import { initialState } from '../src/shared/session'

/** Minimal browser WebSocket stand-in that records traffic. */
class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static all: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  sent: ClientCommand[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientCommand)
  }
  close() {
    this.readyState = FakeSocket.CLOSED
  }
  // Test controls:
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop() {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }
  types() {
    return this.sent.map((c) => c.type)
  }
}

const latest = () => FakeSocket.all.at(-1)!
const item = (id: string): QueueItem => ({
  id,
  addedAt: 0,
  ball: true,
  song: { id: `s-${id}`, title: id, artist: '', album: '', category: '', path: '' },
})
const stateWith = (patch: Partial<SessionState>): SessionState => ({ ...initialState(), ...patch })

let scope: EffectScope
let doc: EventTarget & { visibilityState: string }
let win: EventTarget

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  win = new EventTarget()
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('location', { protocol: 'http:', host: 'karaoke.lan:3000' })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const start = (role: 'screen' | 'remote') => scope.run(() => useSession(role))!

describe('useSession', () => {
  it('says hello on connect and exposes state', () => {
    const s = start('remote')
    expect(latest().url).toBe('ws://karaoke.lan:3000/ws')
    latest().open()
    expect(latest().sent).toEqual([{ type: 'hello', role: 'remote' }])
    latest().receive({ type: 'state', state: stateWith({ screens: 1 }) })
    expect(s.connected.value).toBe(true)
    expect(s.state.value?.screens).toBe(1)
  })

  it('does not queue commands while disconnected', () => {
    const s = start('remote')
    expect(s.send({ type: 'skip' })).toBe(false)
    latest().open()
    expect(latest().types()).toEqual(['hello'])
  })

  it('reconnects with backoff after the socket closes', () => {
    const s = start('remote')
    latest().open()
    latest().drop()
    expect(s.connected.value).toBe(false)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('re-sends screen reports after reconnecting until the state confirms them', () => {
    const s = start('screen')
    const first = latest()
    first.open()
    first.receive({ type: 'state', state: stateWith({ current: item('a'), status: 'playing' }) })

    // The song ends while the network is down: the report is kept.
    first.drop()
    s.report({ type: 'progress', itemId: 'a', positionMs: 1000 })
    s.report({ type: 'progress', itemId: 'a', positionMs: 2000 })
    s.report({ type: 'ended', itemId: 'a' })
    vi.advanceTimersByTime(500)

    const second = latest()
    second.open()
    expect(second.sent).toEqual([
      { type: 'hello', role: 'screen' },
      { type: 'progress', itemId: 'a', positionMs: 2000 },
      { type: 'ended', itemId: 'a' },
    ])

    // A silently lost message: the server still shows song a, so reconnecting re-sends `ended`.
    second.receive({ type: 'state', state: stateWith({ current: item('a'), status: 'playing' }) })
    second.drop()
    vi.advanceTimersByTime(1000)
    latest().open()
    expect(latest().types()).toEqual(['hello', 'ended'])

    // Once the server moved on, nothing is re-sent.
    latest().receive({ type: 'state', state: stateWith({ current: item('b'), status: 'loading' }) })
    latest().drop()
    vi.advanceTimersByTime(2000)
    latest().open()
    expect(latest().types()).toEqual(['hello'])
  })

  it('keeps `loaded` until the server leaves the loading status', () => {
    const s = start('screen')
    latest().open()
    latest().receive({ type: 'state', state: stateWith({ current: item('a'), status: 'loading' }) })
    s.report({ type: 'loaded', itemId: 'a', durationMs: 1000 })
    latest().receive({ type: 'state', state: stateWith({ current: item('a'), status: 'loading' }) })
    latest().drop()
    vi.advanceTimersByTime(500)
    latest().open()
    expect(latest().types()).toEqual(['hello', 'loaded'])
    latest().receive({ type: 'state', state: stateWith({ current: item('a'), status: 'playing' }) })
    latest().drop()
    vi.advanceTimersByTime(1000)
    latest().open()
    expect(latest().types()).toEqual(['hello'])
  })

  it('replaces a silently dead socket when pings go unanswered', () => {
    start('remote')
    const ws = latest()
    ws.open()
    vi.advanceTimersByTime(15_000)
    expect(ws.types()).toEqual(['hello', 'ping'])
    ws.receive({ type: 'pong' })
    vi.advanceTimersByTime(15_000)
    expect(FakeSocket.all).toHaveLength(1)
    // No answer to the second ping: give up on this socket and reconnect.
    vi.advanceTimersByTime(5_000)
    expect(ws.readyState).toBe(FakeSocket.CLOSED)
    vi.advanceTimersByTime(500)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('retries a connection attempt that hangs', () => {
    start('remote')
    vi.advanceTimersByTime(5_000)
    expect(latest().readyState).toBe(FakeSocket.CLOSED)
    vi.advanceTimersByTime(500)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('reconnects immediately after the phone wakes up from sleep', () => {
    start('remote')
    const ws = latest()
    ws.open()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(60_000)
    // The socket looks open, but after a long sleep it is not trusted.
    const before = FakeSocket.all.length
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(FakeSocket.all.length).toBe(before + 1)
    expect(ws.readyState).toBe(FakeSocket.CLOSED)
  })

  it('keeps the socket after a short glance away', () => {
    start('remote')
    latest().open()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(3_000)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('skips the backoff when the network comes back', () => {
    start('remote')
    latest().open()
    for (let i = 0; i < 4; i++) latest().drop() // backoff grows
    const before = FakeSocket.all.length
    win.dispatchEvent(new Event('online'))
    expect(FakeSocket.all.length).toBe(before + 1)
  })

  it('closes and stops reconnecting when disposed', () => {
    start('remote')
    const ws = latest()
    ws.open()
    scope.stop()
    expect(ws.readyState).toBe(FakeSocket.CLOSED)
    vi.advanceTimersByTime(60_000)
    win.dispatchEvent(new Event('online'))
    expect(FakeSocket.all).toHaveLength(1)
  })
})
