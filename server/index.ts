import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { createApp } from './app'
import { loadConfig } from './config'
import { openDb } from './db/database'
import { SessionHub } from './hub'
import { Indexer } from './indexer'
import { SettingsRepository } from './settings'
import { SongRepository } from './songs'

const config = loadConfig()
const db = openDb(config.dbPath)
const songs = new SongRepository(db)
const hub = new SessionHub(songs, { settings: new SettingsRepository(db) })
const indexer = new Indexer({ db, songs, root: config.libraryRoot, onStatus: (s) => hub.setScan(s) })

const app = createApp({ ...config, db, songs, indexer, hub, staticDir: config.staticDir })

const wss = new WebSocketServer({ noServer: true })
const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host, websocket: { server: wss } },
  (info) => console.log(`Karaokej listening on port ${info.port}`),
)

// Drop WebSocket clients that stopped answering pings (e.g. a phone that went to sleep).
const alive = new WeakSet<object>()
wss.on('connection', (ws) => {
  alive.add(ws)
  ws.on('pong', () => alive.add(ws))
})
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) ws.terminate()
    else {
      alive.delete(ws)
      ws.ping()
    }
  }
}, 30_000)

function rescan() {
  indexer.scan().then(
    (r) =>
      console.log(
        `Library indexed: ${r.found} files (${r.added} new, ${r.updated} changed, ${r.removed} removed)`,
      ),
    (e: unknown) => console.error('Library scan failed:', e),
  )
}
rescan()
const rescanTimer = config.rescanMinutes > 0 ? setInterval(rescan, config.rescanMinutes * 60_000) : undefined

function shutdown() {
  clearInterval(heartbeat)
  clearInterval(rescanTimer)
  for (const ws of wss.clients) ws.terminate()
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
