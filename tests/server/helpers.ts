import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createApp, type AppDeps } from '../../server/app'
import { openDb } from '../../server/db/database'
import { SessionHub } from '../../server/hub'
import { Indexer } from '../../server/indexer'
import { SongRepository } from '../../server/songs'
import { buildKfn, songIniText } from '../../src/kfn/buildKfn'
import { KfnEntryType } from '../../src/kfn/parseKfn'

export function kfnBytes(title: string, artist = '', album = ''): Uint8Array {
  const ini = songIniText({ title, artist, musicFile: 'a.mp3', texts: ['la'], syncs: [100] })
  return buildKfn({
    header: { TITL: title, ARTS: artist, ALBM: album, SORC: '1,I,a.mp3' },
    entries: [
      { name: 'a.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33) },
      { name: 'Song.ini', type: KfnEntryType.SongIni, data: new TextEncoder().encode(ini) },
    ],
  })
}

/** A throwaway library directory; files are written relative to it. */
export function tempLibrary() {
  const root = mkdtempSync(join(tmpdir(), 'karaokej-lib-'))
  return {
    root,
    write(path: string, data: Uint8Array | string) {
      const abs = join(root, path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, data)
      return abs
    },
    remove(path: string) {
      rmSync(join(root, path))
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** An indexed in-memory app over `root`, as server/index.ts wires it. */
export async function createTestApp(root: string, overrides: Partial<AppDeps> = {}) {
  const db = openDb(':memory:')
  const songs = new SongRepository(db)
  const indexer = new Indexer({ db, songs, root })
  await indexer.scan()
  const app = createApp({
    db,
    songs,
    indexer,
    hub: new SessionHub(songs),
    libraryRoot: root,
    publicUrl: null,
    ...overrides,
  })
  return { app, db, songs, indexer }
}
