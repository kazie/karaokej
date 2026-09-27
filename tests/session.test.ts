import { describe, expect, it } from 'vitest'
import { initialState, reduce, type SessionAction } from '../src/shared/session'
import type { QueueItem, SessionState } from '../src/shared/protocol'

function item(id: string): QueueItem {
  return {
    id,
    addedAt: 0,
    ball: true,
    song: { id: `song-${id}`, title: id, artist: '', album: '', category: '', path: `${id}.kfn` },
  }
}

function run(...actions: SessionAction[]): SessionState {
  return actions.reduce(reduce, initialState())
}

const ids = (s: SessionState) => s.queue.map((i) => i.id)

describe('session reducer', () => {
  it('starts the first enqueued song and queues the rest', () => {
    const s = run({ type: 'enqueue', item: item('a') }, { type: 'enqueue', item: item('b') })
    expect(s.current?.id).toBe('a')
    expect(s.status).toBe('loading')
    expect(ids(s)).toEqual(['b'])
  })

  it('plays once the screen reports loaded, and only for the current item', () => {
    const s = run({ type: 'enqueue', item: item('a') }, { type: 'loaded', itemId: 'x', durationMs: 1 })
    expect(s.status).toBe('loading')
    const loaded = reduce(s, { type: 'loaded', itemId: 'a', durationMs: 5000 })
    expect(loaded).toMatchObject({ status: 'playing', durationMs: 5000 })
  })

  it('advances on ended, then goes idle', () => {
    let s = run({ type: 'enqueue', item: item('a') }, { type: 'enqueue', item: item('b') })
    s = reduce(s, { type: 'ended', itemId: 'a' })
    expect(s.current?.id).toBe('b')
    expect(s.queue).toEqual([])
    s = reduce(s, { type: 'ended', itemId: 'a' })
    expect(s.current?.id).toBe('b')
    s = reduce(s, { type: 'ended', itemId: 'b' })
    expect(s).toMatchObject({ current: null, status: 'idle' })
  })

  it('skips, pauses, resumes and restarts', () => {
    let s = run(
      { type: 'enqueue', item: item('a') },
      { type: 'enqueue', item: item('b') },
      { type: 'loaded', itemId: 'a', durationMs: 1 },
    )
    s = reduce(s, { type: 'pause' })
    expect(s.status).toBe('paused')
    expect(reduce(s, { type: 'pause' })).toBe(s)
    s = reduce(s, { type: 'resume' })
    expect(s.status).toBe('playing')
    s = reduce(reduce(s, { type: 'progress', itemId: 'a', positionMs: 900 }), { type: 'restart' })
    expect(s.request).toEqual({ seq: 1, kind: 'restart' })
    s = reduce(s, { type: 'skip' })
    expect(s).toMatchObject({ status: 'loading', current: { id: 'b' } })
  })

  it('removes, moves and plays queued items now', () => {
    let s = run(...['a', 'b', 'c', 'd'].map((id) => ({ type: 'enqueue' as const, item: item(id) })))
    s = reduce(s, { type: 'move', itemId: 'd', toIndex: 0 })
    expect(ids(s)).toEqual(['d', 'b', 'c'])
    s = reduce(s, { type: 'move', itemId: 'd', toIndex: 99 })
    expect(ids(s)).toEqual(['b', 'c', 'd'])
    s = reduce(s, { type: 'remove', itemId: 'c' })
    expect(ids(s)).toEqual(['b', 'd'])
    s = reduce(s, { type: 'playNow', itemId: 'd' })
    expect(s.current?.id).toBe('d')
    expect(ids(s)).toEqual(['b'])
    s = reduce(s, { type: 'remove', itemId: 'd' })
    expect(s.current?.id).toBe('b')
  })

  it('ignores unknown items', () => {
    const s = run({ type: 'enqueue', item: item('a') })
    expect(reduce(s, { type: 'remove', itemId: 'zz' })).toBe(s)
    expect(reduce(s, { type: 'move', itemId: 'zz', toIndex: 0 })).toBe(s)
    expect(reduce(s, { type: 'playNow', itemId: 'zz' })).toBe(s)
    expect(reduce(initialState(), { type: 'skip' })).toEqual(initialState())
  })

  it('records failures and moves on', () => {
    const s = run(
      { type: 'enqueue', item: item('a') },
      { type: 'enqueue', item: item('b') },
      { type: 'failed', itemId: 'a', message: 'bad file' },
    )
    expect(s.current?.id).toBe('b')
    expect(s.lastError).toBe('Could not play a: bad file')
  })
})

describe('playback controls', () => {
  const playing = () =>
    run(
      { type: 'enqueue', item: item('a') },
      { type: 'enqueue', item: item('b') },
      { type: 'loaded', itemId: 'a', durationMs: 1 },
    )

  it('numbers seek, restart and skip requests for the screen', () => {
    let s = reduce(playing(), { type: 'seekBy', deltaMs: 10_000 })
    expect(s.request).toEqual({ seq: 1, kind: 'seekBy', deltaMs: 10_000 })
    s = reduce(s, { type: 'restart' })
    expect(s.request).toEqual({ seq: 2, kind: 'restart' })
    s = reduce(s, { type: 'seekBy', deltaMs: -1e12 })
    expect(s.request).toMatchObject({ seq: 3, deltaMs: -600_000 })
    expect(reduce(initialState(), { type: 'seekBy', deltaMs: 1 }).request).toBeNull()
  })

  it('ignores seek, restart and skip while the song is still loading', () => {
    const loading = run({ type: 'enqueue', item: item('a') })
    expect(loading.status).toBe('loading')
    expect(reduce(loading, { type: 'seekBy', deltaMs: 10_000 })).toBe(loading)
    expect(reduce(loading, { type: 'restart' })).toBe(loading)
    const skippable = reduce(loading, { type: 'progress', itemId: 'a', positionMs: 0, skippable: true })
    expect(reduce(skippable, { type: 'skipInterlude' })).toBe(skippable)
  })

  it('only skips an interlude the screen reported as skippable', () => {
    let s = playing()
    expect(reduce(s, { type: 'skipInterlude' })).toBe(s)
    s = reduce(s, { type: 'progress', itemId: 'a', positionMs: 500, skippable: true })
    expect(s.skippable).toBe(true)
    expect(reduce(s, { type: 'skipInterlude' }).request).toEqual({ seq: 1, kind: 'skipGap' })
    s = reduce(s, { type: 'progress', itemId: 'a', positionMs: 900 })
    expect(s.skippable).toBe(false)
  })

  it('snaps speed to the offered steps and resets it for the next song', () => {
    let s = reduce(playing(), { type: 'setSpeed', rate: 1.23 })
    expect(s.playbackRate).toBe(1.2)
    expect(reduce(s, { type: 'setSpeed', rate: 9 }).playbackRate).toBe(2)
    expect(reduce(s, { type: 'setSpeed', rate: 0.1 }).playbackRate).toBe(0.5)
    s = reduce(s, { type: 'skip' })
    expect(s).toMatchObject({ current: { id: 'b' }, playbackRate: 1 })
    expect(reduce(initialState(), { type: 'setSpeed', rate: 2 }).playbackRate).toBe(1)
  })

  it('toggles the ball per song and the auto-skip setting', () => {
    let s = reduce(playing(), { type: 'setBall', itemId: 'a', enabled: false })
    expect(s.current?.ball).toBe(false)
    s = reduce(s, { type: 'setBall', itemId: 'b', enabled: false })
    expect(s.queue[0]?.ball).toBe(false)
    expect(reduce(s, { type: 'setBall', itemId: 'zz', enabled: true })).toBe(s)
    s = reduce(s, { type: 'setAutoSkip', enabled: true })
    expect(s.settings.autoSkipInterludes).toBe(true)
    expect(reduce(s, { type: 'setAutoSkip', enabled: true })).toBe(s)
  })
})
