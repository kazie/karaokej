import { chmodSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Database } from '../../server/db/database'
import { Indexer, songId } from '../../server/indexer'
import { parseSearch, SongRepository } from '../../server/songs'
import { kfnBytes, tempLibrary } from './helpers'

let lib: ReturnType<typeof tempLibrary>
let db: Database
let songs: SongRepository

beforeEach(() => {
  lib = tempLibrary()
  db = openDb(':memory:')
  songs = new SongRepository(db)
  lib.write('Anime/O/ONE PIECE - We Are!.kfn', kfnBytes('We Are!', 'Kitadani Hiroshi', 'ONE PIECE'))
  lib.write('Anime/P/Pokémon.kfn', kfnBytes('Pokémon Theme', 'Iwasaki Hiromi', 'Pocket Monsters'))
  lib.write('Övrigt/Kväll.KFN', kfnBytes('Kväll', 'Någon'))
  lib.write('Övrigt/broken.kfn', 'not a kfn file')
  lib.write('Övrigt/notes.txt', 'ignore me')
  lib.write('root.kfn', kfnBytes(''))
})

afterEach(() => lib.cleanup())

const indexer = () => new Indexer({ db, songs, root: lib.root, concurrency: 2 })

describe('Indexer', () => {
  it('indexes .kfn files with metadata, categories and fallbacks', async () => {
    const result = await indexer().scan()
    expect(result).toMatchObject({ found: 5, added: 5, removed: 0, unchanged: 0 })
    expect(songs.count()).toBe(5)

    const row = songs.byId(songId('Anime/O/ONE PIECE - We Are!.kfn'))!
    expect(row).toMatchObject({
      title: 'We Are!',
      artist: 'Kitadani Hiroshi',
      category: 'Anime',
      error: null,
    })

    const broken = songs.byId(songId('Övrigt/broken.kfn'))!
    expect(broken).toMatchObject({ title: 'broken', category: 'Övrigt' })
    expect(broken.error).toMatch(/KFNB/)

    expect(songs.byId(songId('root.kfn'))).toMatchObject({ title: 'root', category: '' })
    expect(songs.categories()).toEqual([
      { category: '', count: 1 },
      { category: 'Anime', count: 2 },
      { category: 'Övrigt', count: 2 },
    ])
  })

  it('re-indexes incrementally: skips unchanged, updates changed, prunes deleted', async () => {
    await indexer().scan()
    lib.write('Anime/P/Pokémon.kfn', kfnBytes('Pokémon Theme (TV size)', 'Iwasaki Hiromi'))
    utimesSync(join(lib.root, 'Anime/P/Pokémon.kfn'), new Date(), new Date(Date.now() + 5000))
    lib.remove('Övrigt/broken.kfn')
    lib.write('New/Song.kfn', kfnBytes('Brand New'))

    const result = await indexer().scan()
    expect(result).toMatchObject({ found: 5, added: 1, updated: 1, removed: 1, unchanged: 3 })
    expect(songs.byId(songId('Anime/P/Pokémon.kfn'))?.title).toBe('Pokémon Theme (TV size)')
    expect(songs.byId(songId('Övrigt/broken.kfn'))).toBeUndefined()
    expect(songs.search({ q: 'tv size' }).songs.map((s) => s.title)).toEqual(['Pokémon Theme (TV size)'])
  })

  it('keeps every row when parallel workers flush batches', async () => {
    for (let i = 0; i < 40; i++) lib.write(`Bulk/${i}.kfn`, kfnBytes(`Bulk ${i}`))
    const result = await new Indexer({ db, songs, root: lib.root, concurrency: 6, batchSize: 3 }).scan()
    expect(result.found).toBe(45)
    expect(songs.count()).toBe(45)
  })

  // Root ignores directory permissions, so this can only be tested as a normal user.
  it.skipIf(process.getuid?.() === 0)('skips unreadable subdirectories instead of failing', async () => {
    lib.write('lost+found/hidden.kfn', kfnBytes('Hidden'))
    chmodSync(join(lib.root, 'lost+found'), 0o000)
    try {
      const result = await indexer().scan()
      expect(result.found).toBe(5)
      expect(songs.count()).toBe(5)
    } finally {
      chmodSync(join(lib.root, 'lost+found'), 0o755)
    }
  })

  it('follows symlinked directories once', async () => {
    symlinkSync(join(lib.root, 'Anime'), join(lib.root, 'AnimeLink'))
    symlinkSync(lib.root, join(lib.root, 'Anime', 'loop'))
    const result = await indexer().scan()
    expect(result.found).toBe(5)
  })

  it('joins a scan that is already running and reports status', async () => {
    const statuses: boolean[] = []
    const ix = new Indexer({ db, songs, root: lib.root, onStatus: (s) => statuses.push(s.running) })
    const [a, b] = [ix.scan(), ix.scan()]
    expect(a).toBe(b)
    await a
    expect(statuses[0]).toBe(true)
    expect(statuses.at(-1)).toBe(false)
    expect(ix.status).toMatchObject({ running: false, songCount: 5, total: 5, done: 5 })
  })

  it('keeps the index when the library folder is suddenly empty (e.g. an unmounted share)', async () => {
    await indexer().scan()
    for (const f of [
      'Anime/O/ONE PIECE - We Are!.kfn',
      'Anime/P/Pokémon.kfn',
      'Övrigt/Kväll.KFN',
      'Övrigt/broken.kfn',
      'root.kfn',
    ]) {
      lib.remove(f)
    }
    const ix = indexer()
    await expect(ix.scan()).rejects.toThrow(/keeping the existing index/)
    expect(songs.count()).toBe(5)
    expect(ix.status).toMatchObject({ running: false, songCount: 5 })
    expect(ix.status.lastError).toMatch(/Is the library mounted/)
  })

  it('indexes a brand-new empty library without complaint', async () => {
    const empty = tempLibrary()
    try {
      const result = await new Indexer({ db, songs, root: empty.root }).scan()
      expect(result.found).toBe(0)
    } finally {
      empty.cleanup()
    }
  })

  it('records a failed scan', async () => {
    const ix = new Indexer({ db, songs, root: join(lib.root, 'missing') })
    await expect(ix.scan()).rejects.toThrow()
    expect(ix.status.lastError).toMatch(/ENOENT/)
  })
})

describe('SongRepository.search', () => {
  beforeEach(async () => {
    await indexer().scan()
  })

  it('matches prefixes, ignores diacritics and case', () => {
    expect(songs.search({ q: 'pokemon' }).songs.map((s) => s.title)).toEqual(['Pokémon Theme'])
    expect(songs.search({ q: 'KVALL' }).total).toBe(1)
    expect(songs.search({ q: 'kita we' }).songs.map((s) => s.title)).toEqual(['We Are!'])
    expect(songs.search({ q: 'nothing-matches-this' }).total).toBe(0)
  })

  it('handles quotes and FTS syntax safely', () => {
    expect(parseSearch('  a "b" ')).toEqual({ match: '"a"* """b"""*', literals: [] })
    expect(parseSearch('   ')).toEqual({ match: null, literals: [] })
    expect(() => songs.search({ q: 'NEAR( " * OR -' })).not.toThrow()
  })

  it('matches symbol-only terms literally', () => {
    lib.write('Musikal/Rock & Roll.kfn', kfnBytes('Rock & Roll', 'Band - Live'))
    lib.write('Musikal/100%.kfn', kfnBytes('100% Pure', 'Some_Artist'))
    return indexer()
      .scan()
      .then(() => {
        expect(parseSearch('rock & -')).toEqual({ match: '"rock"*', literals: ['&', '-'] })
        expect(songs.search({ q: '&' }).songs.map((s) => s.title)).toEqual(['Rock & Roll'])
        expect(songs.search({ q: '-' }).songs.map((s) => s.title)).toEqual(['Rock & Roll'])
        expect(songs.search({ q: 'roll &' }).total).toBe(1)
        expect(songs.search({ q: 'pure &' }).total).toBe(0)
        // LIKE wildcards are literal characters here.
        expect(songs.search({ q: '%' }).songs.map((s) => s.title)).toEqual(['100% Pure'])
        expect(songs.search({ q: '_' }).songs.map((s) => s.artist)).toEqual(['Some_Artist'])
      })
  })

  it('filters by category and pages results', () => {
    expect(songs.search({ category: 'Anime' }).total).toBe(2)
    // '' is the library root, not "all categories".
    expect(songs.search({ category: '' }).songs.map((s) => s.path)).toEqual(['root.kfn'])
    expect(songs.search({}).total).toBe(5)
    expect(songs.search({ q: 'pokemon', category: 'Övrigt' }).total).toBe(0)
    const page = songs.search({ limit: 2, offset: 2 })
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 })
    expect(page.songs).toHaveLength(2)
    expect(songs.search({ limit: 1000 }).limit).toBe(50)
  })

  it('lists by artist then title without a query', () => {
    expect(songs.search().songs.map((s) => s.artist)).toEqual([
      '',
      '',
      'Iwasaki Hiromi',
      'Kitadani Hiroshi',
      'Någon',
    ])
  })
})
