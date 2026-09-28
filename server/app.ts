import { createReadStream, existsSync } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { upgradeWebSocket } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { ServerInfo } from '../src/shared/protocol'
import { WS_PATH } from '../src/shared/protocol'
import type { Database } from './db/database'
import type { SessionHub } from './hub'
import type { Indexer } from './indexer'
import type { SongRepository } from './songs'

export interface AppDeps {
  db: Database
  songs: SongRepository
  indexer: Indexer
  hub: SessionHub
  libraryRoot: string
  publicUrl: string | null
  staticDir?: string
}

async function hasEntries(dir: string): Promise<boolean> {
  try {
    const d = await opendir(dir)
    const first = await d.read()
    await d.close()
    return first !== null
  } catch {
    return false
  }
}

export function createApp(deps: AppDeps): Hono {
  const { db, songs, indexer, hub, libraryRoot } = deps
  const app = new Hono()

  app.get('/api/health', async (c) => {
    let dbOk = false
    try {
      db.prepare('SELECT 1').get()
      dbOk = true
    } catch {
      /* reported below */
    }
    // An empty library folder while songs are indexed usually means an unmounted share.
    const libraryReachable =
      (await stat(libraryRoot).then(
        (s) => s.isDirectory(),
        () => false,
      )) &&
      ((await hasEntries(libraryRoot)) || songs.count() === 0)
    const ok = dbOk && libraryReachable
    return c.json({ ok, db: dbOk, libraryReachable }, ok ? 200 : 503)
  })

  app.get('/api/info', (c) => c.json<ServerInfo>({ publicUrl: deps.publicUrl }))

  app.get('/api/songs', (c) =>
    c.json(
      songs.search({
        q: c.req.query('q'),
        category: c.req.query('category'),
        subcategory: c.req.query('subcategory'),
        // Missing or invalid values fall back to the repository's defaults.
        offset: Number(c.req.query('offset')),
        limit: Number(c.req.query('limit')),
      }),
    ),
  )

  app.get('/api/categories', (c) => c.json(songs.categories()))

  app.get('/api/songs/:id/file', async (c) => {
    const row = songs.byId(c.req.param('id'))
    const root = resolve(libraryRoot)
    const abs = row && resolve(root, row.path)
    if (!abs?.startsWith(root + sep)) return c.json({ error: 'Song not found' }, 404)
    const info = await stat(abs).catch(() => null)
    if (!info?.isFile()) return c.json({ error: 'File is no longer available' }, 410)
    const body = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  })

  app.post('/api/library/rescan', (c) => {
    indexer.scan().catch(() => {
      /* failure is recorded in indexer.status */
    })
    return c.json(indexer.status, 202)
  })

  app.get(
    WS_PATH,
    upgradeWebSocket(() => {
      let client: ReturnType<SessionHub['connect']> | undefined
      return {
        onOpen(_event, ws) {
          client = hub.connect((json) => ws.send(json))
        },
        onMessage(event) {
          if (client) hub.handle(client, String(event.data))
        },
        onClose() {
          if (client) hub.disconnect(client)
        },
      }
    }),
  )

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  const { staticDir } = deps
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use('/*', serveStatic({ root: staticDir }))
    // Client-side routes (/screen, /remote) fall back to the SPA.
    app.get('/*', serveStatic({ root: staticDir, path: 'index.html' }))
  }

  return app
}
