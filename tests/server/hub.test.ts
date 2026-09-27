import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../server/db/database'
import { parseCommand, SessionHub } from '../../server/hub'
import { SongRepository } from '../../server/songs'
import type { ServerMessage } from '../../src/shared/protocol'

function setup() {
  const db = openDb(':memory:')
  db.prepare(
    `INSERT INTO songs (id, path, category, title, artist, album, size, mtime_ms, indexed_at)
     VALUES ('s1', 'A/one.kfn', 'A', 'One', 'Artist', '', 1, 1, 1), ('s2', 'A/two.kfn', 'A', 'Two', '', '', 1, 1, 1)`,
  ).run()
  let n = 0
  const hub = new SessionHub(
    new SongRepository(db),
    () => `item${++n}`,
    () => 42,
  )
  const client = () => {
    const inbox: ServerMessage[] = []
    const c = hub.connect((json) => inbox.push(JSON.parse(json) as ServerMessage))
    return { c, inbox, last: () => inbox.at(-1)! }
  }
  return { hub, client }
}

let ctx: ReturnType<typeof setup>
beforeEach(() => {
  ctx = setup()
})

describe('parseCommand', () => {
  it('validates messages', () => {
    expect(parseCommand('{"type":"move","itemId":"a","toIndex":2}')).toEqual({
      type: 'move',
      itemId: 'a',
      toIndex: 2,
    })
    expect(() => parseCommand('nope')).toThrow(/JSON/)
    expect(() => parseCommand('{"type":"remove"}')).toThrow(/itemId/)
    expect(() => parseCommand('{"type":"move","itemId":"a","toIndex":"x"}')).toThrow(/toIndex/)
    expect(() => parseCommand('{"type":"hello","role":"admin"}')).toThrow(/role/)
    expect(() => parseCommand('{"type":"rm -rf"}')).toThrow(/Unknown/)
    expect(() => parseCommand('null')).toThrow(/Invalid message/)
    expect(parseCommand('{"type":"setSpeed","rate":1.5}')).toEqual({ type: 'setSpeed', rate: 1.5 })
    expect(() => parseCommand('{"type":"setSpeed","rate":"fast"}')).toThrow(/rate/)
    expect(() => parseCommand('{"type":"seekBy","deltaMs":null}')).toThrow(/deltaMs/)
    expect(() => parseCommand('{"type":"setBall","itemId":"a","enabled":"yes"}')).toThrow(/enabled/)
    expect(() => parseCommand('{"type":"setAutoSkip"}')).toThrow(/enabled/)
    expect(parseCommand('{"type":"skipInterlude"}')).toEqual({ type: 'skipInterlude' })
    expect(parseCommand('{"type":"enqueue","songId":"s","ball":false}')).toMatchObject({ ball: false })
    const progress = parseCommand('{"type":"progress","itemId":"a","positionMs":1}')
    expect(progress.type === 'progress' && progress.skippable).toBeUndefined()
  })
})

describe('SessionHub', () => {
  it('sends the current state on connect and broadcasts changes', () => {
    const a = ctx.client()
    const b = ctx.client()
    expect(a.last()).toMatchObject({ type: 'state', state: { status: 'idle' } })
    ctx.hub.handle(a.c, JSON.stringify({ type: 'enqueue', songId: 's1', singer: '  Kim  ' }))
    for (const x of [a, b]) {
      expect(x.last()).toMatchObject({
        type: 'state',
        state: {
          status: 'loading',
          current: { id: 'item1', singer: 'Kim', addedAt: 42, song: { title: 'One', path: 'A/one.kfn' } },
        },
      })
    }
  })

  it('rejects unknown songs and bad input with an error to the sender only', () => {
    const a = ctx.client()
    const b = ctx.client()
    ctx.hub.handle(a.c, JSON.stringify({ type: 'enqueue', songId: 'missing' }))
    expect(a.last()).toEqual({ type: 'error', message: 'Song not found' })
    ctx.hub.handle(a.c, '{')
    expect(a.last()).toEqual({ type: 'error', message: 'Invalid JSON' })
    expect(b.inbox).toHaveLength(1)
  })

  it('counts screens and only lets screens report playback', () => {
    const remote = ctx.client()
    const screen = ctx.client()
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'enqueue', songId: 's1' }))
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'ended', itemId: 'item1' }))
    expect(remote.last()).toMatchObject({ type: 'error', message: 'Only screens may send ended' })

    ctx.hub.handle(screen.c, JSON.stringify({ type: 'hello', role: 'screen' }))
    expect(ctx.hub.state.screens).toBe(1)
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'loaded', itemId: 'item1', durationMs: 1000 }))
    expect(ctx.hub.state.status).toBe('playing')
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'ended', itemId: 'item1' }))
    expect(ctx.hub.state.status).toBe('idle')

    ctx.hub.disconnect(screen.c)
    expect(ctx.hub.state.screens).toBe(0)
    expect(remote.last()).toMatchObject({ state: { screens: 0 } })
  })

  it('answers ping with pong to the sender only', () => {
    const a = ctx.client()
    const b = ctx.client()
    ctx.hub.handle(a.c, JSON.stringify({ type: 'ping' }))
    expect(a.last()).toEqual({ type: 'pong' })
    expect(b.inbox).toHaveLength(1)
  })

  it('plays songs of unknown length (duration 0) and rejects a missing duration', () => {
    const remote = ctx.client()
    const screen = ctx.client()
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'hello', role: 'screen' }))
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'enqueue', songId: 's1' }))
    // Infinity serializes as null, which must not be accepted as a length.
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'loaded', itemId: 'item1', durationMs: Infinity }))
    expect(screen.last()).toEqual({ type: 'error', message: 'Invalid durationMs' })
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'loaded', itemId: 'item1', durationMs: 0 }))
    expect(ctx.hub.state).toMatchObject({ status: 'playing', durationMs: 0 })
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'pause' }))
    expect(ctx.hub.state.status).toBe('paused')
  })

  it('passes the skippable report from the screen through to the session', () => {
    const remote = ctx.client()
    const screen = ctx.client()
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'hello', role: 'screen' }))
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'enqueue', songId: 's1' }))
    ctx.hub.handle(screen.c, JSON.stringify({ type: 'loaded', itemId: 'item1', durationMs: 60_000 }))
    ctx.hub.handle(
      screen.c,
      JSON.stringify({ type: 'progress', itemId: 'item1', positionMs: 0, skippable: true }),
    )
    expect(ctx.hub.state.skippable).toBe(true)
    ctx.hub.handle(remote.c, JSON.stringify({ type: 'skipInterlude' }))
    expect(ctx.hub.state.request).toEqual({ seq: 1, kind: 'skipGap' })
    ctx.hub.handle(
      screen.c,
      JSON.stringify({ type: 'progress', itemId: 'item1', positionMs: 1, skippable: 'x' }),
    )
    expect(screen.last()).toEqual({ type: 'error', message: 'Invalid skippable' })
  })

  it('queues songs with the ball on unless the singer turned it off', () => {
    const a = ctx.client()
    ctx.hub.handle(a.c, JSON.stringify({ type: 'enqueue', songId: 's1' }))
    ctx.hub.handle(a.c, JSON.stringify({ type: 'enqueue', songId: 's2', ball: false }))
    expect(ctx.hub.state.current?.ball).toBe(true)
    expect(ctx.hub.state.queue[0]?.ball).toBe(false)
  })

  it('does not broadcast when nothing changed', () => {
    const a = ctx.client()
    ctx.hub.handle(a.c, JSON.stringify({ type: 'pause' }))
    expect(a.inbox).toHaveLength(1)
  })
})
