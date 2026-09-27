import { serve, type ServerType } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { songId } from '../../server/indexer'
import type { ServerMessage, SessionState } from '../../src/shared/protocol'
import { createTestApp, kfnBytes, tempLibrary } from './helpers'

const lib = tempLibrary()
let server: ServerType
let url: string

beforeAll(async () => {
  lib.write('A/Song.kfn', kfnBytes('Song'))
  const { app } = await createTestApp(lib.root)
  const wss = new WebSocketServer({ noServer: true })
  await new Promise<void>((done) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: wss } }, () =>
      done(),
    )
  })
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`
})

afterAll(async () => {
  await new Promise((done) => server.close(done))
  lib.cleanup()
})

function connect() {
  const ws = new WebSocket(url)
  const states: SessionState[] = []
  const waiters: [(s: SessionState) => boolean, (s: SessionState) => void][] = []
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as ServerMessage
    if (msg.type !== 'state') return
    states.push(msg.state)
    for (const [pred, resolve] of [...waiters]) {
      if (pred(msg.state)) {
        waiters.splice(
          waiters.findIndex((w) => w[1] === resolve),
          1,
        )
        resolve(msg.state)
      }
    }
  })
  const until = (pred: (s: SessionState) => boolean) =>
    new Promise<SessionState>((resolve) => {
      const hit = states.find(pred)
      if (hit) resolve(hit)
      else waiters.push([pred, resolve])
    })
  const send = (msg: object) => ws.send(JSON.stringify(msg))
  const opened = new Promise((r) => ws.once('open', r))
  return { ws, until, send, opened }
}

describe('WebSocket session', () => {
  it('lets a remote queue a song and a screen play it to the end', async () => {
    const screen = connect()
    const remote = connect()
    await Promise.all([screen.opened, remote.opened])

    screen.send({ type: 'hello', role: 'screen' })
    await remote.until((s) => s.screens === 1)

    remote.send({ type: 'enqueue', songId: songId('A/Song.kfn'), singer: 'Alex' })
    const loading = await screen.until((s) => s.status === 'loading')
    const itemId = loading.current!.id
    expect(loading.current).toMatchObject({ singer: 'Alex', song: { title: 'Song' } })

    screen.send({ type: 'loaded', itemId, durationMs: 1000 })
    await remote.until((s) => s.status === 'playing')
    screen.send({ type: 'ended', itemId })
    await remote.until((s) => s.status === 'idle' && s.current === null)

    screen.ws.close()
    await remote.until((s) => s.screens === 0)
    remote.ws.close()
  })
})
