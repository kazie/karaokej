import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { songId } from '../../server/indexer'
import { parseKfn } from '../../src/kfn/parseKfn'
import type { CategoryCount, ServerInfo, SongPage } from '../../src/shared/protocol'
import { createTestApp, kfnBytes, tempLibrary } from './helpers'

const lib = tempLibrary()
const staticDir = mkdtempSync(join(tmpdir(), 'karaokej-static-'))
let app: Awaited<ReturnType<typeof createTestApp>>['app']

beforeAll(async () => {
  lib.write('Anime/We Are.kfn', kfnBytes('We Are!', 'Kitadani Hiroshi'))
  lib.write('Jul/Snow.kfn', kfnBytes('Snow'))
  writeFileSync(join(staticDir, 'index.html'), '<title>Karaokej</title>')
  ;({ app } = await createTestApp(lib.root, { publicUrl: 'http://karaoke.local', staticDir }))
})

afterAll(() => {
  lib.cleanup()
  rmSync(staticDir, { recursive: true, force: true })
})

const get = (path: string) => app.request(path)

describe('REST API', () => {
  it('reports health and info', async () => {
    const health = await get('/api/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, db: true, libraryReachable: true })

    expect((await (await get('/api/info')).json()) as ServerInfo).toEqual({
      publicUrl: 'http://karaoke.local',
    })
  })

  it('searches songs and lists categories', async () => {
    const page = (await (await get('/api/songs?q=kitadani')).json()) as SongPage
    expect(page.total).toBe(1)
    expect(page.songs[0]).toMatchObject({ title: 'We Are!', category: 'Anime', path: 'Anime/We Are.kfn' })
    const byCategory = (await (await get('/api/songs?category=Jul')).json()) as SongPage
    expect(byCategory.songs.map((s) => s.title)).toEqual(['Snow'])
    const rootOnly = (await (await get('/api/songs?category=')).json()) as SongPage
    expect(rootOnly.total).toBe(0)
    expect((await (await get('/api/categories')).json()) as CategoryCount[]).toEqual([
      { category: 'Anime', count: 1 },
      { category: 'Jul', count: 1 },
    ])
  })

  it('streams a song file', async () => {
    const id = songId('Anime/We Are.kfn')
    const res = await get(`/api/songs/${id}/file`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    expect(parseKfn(bytes).meta.title).toBe('We Are!')
  })

  it('404s unknown songs and API paths', async () => {
    expect((await get('/api/songs/nope/file')).status).toBe(404)
    expect((await get('/api/songs/..%2F..%2Fetc%2Fpasswd/file')).status).toBe(404)
    expect((await get('/api/whatever')).status).toBe(404)
  })

  it('410s a song whose file disappeared', async () => {
    const id = songId('Jul/Snow.kfn')
    lib.remove('Jul/Snow.kfn')
    expect((await get(`/api/songs/${id}/file`)).status).toBe(410)
  })

  it('reports the library as unavailable when its folder empties while songs are indexed', async () => {
    const empty = tempLibrary()
    try {
      const { app: other } = await createTestApp(empty.root)
      expect((await other.request('/api/health')).status).toBe(200) // new, empty library is fine
      empty.write('A/Song.kfn', kfnBytes('Song'))
      const { app: mounted, indexer } = await createTestApp(empty.root)
      expect((await mounted.request('/api/health')).status).toBe(200)
      empty.remove('A/Song.kfn')
      rmSync(join(empty.root, 'A'), { recursive: true })
      const res = await mounted.request('/api/health')
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ ok: false, db: true, libraryReachable: false })
      expect(indexer.status.songCount).toBe(1)
    } finally {
      empty.cleanup()
    }
  })

  it('starts a rescan', async () => {
    const res = await app.request('/api/library/rescan', { method: 'POST' })
    expect(res.status).toBe(202)
  })

  it('serves the SPA for client routes', async () => {
    for (const path of ['/', '/screen', '/remote']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Karaokej')
    }
  })
})
