import { readonly, ref, shallowRef, watch } from 'vue'
import type { KaraokeServices, Session } from '../services'
import type {
  CategoryCount,
  ClientCommand,
  ClientRole,
  QueueItem,
  ScanStatus,
  ScreenCommand,
  ServerInfo,
  SessionState,
  Song,
  SongPage,
} from '../shared/protocol'
import { initialScan, initialState, reduce, type SessionAction } from '../shared/session'
import { makeDemoKfn } from './demoSong'

/** Fictional catalog for stories: several categories, accents, symbols and more than one page. */
function makeCatalog(): Song[] {
  const artists = [
    'Aurora Lane',
    'The Paper Kites',
    'Café Nova',
    'Mika & The Moons',
    'Studio Seven',
    'Hana Mori',
  ]
  const words = [
    'Summer',
    'Midnight',
    'Neon',
    'River',
    'Paper',
    'Golden',
    'Starlight',
    'Ocean',
    'Café',
    'Echo',
  ]
  const nouns = ['Dreams', 'Lights', 'Road', 'Heart', 'Parade', 'Skies', 'Rain', 'Nights', 'Waltz', 'Signal']
  const categories = ['Anime', 'Games', 'Musicals', 'Pop', '']
  const songs: Song[] = []
  for (let i = 0; i < 64; i++) {
    // Every word/noun pair once, so titles are unique.
    const title = `${words[i % words.length]} ${nouns[Math.floor(i / words.length) % nouns.length]}${i % 9 === 4 ? ' & Friends' : ''}`
    const category = categories[i % categories.length]!
    songs.push({
      id: `song-${i}`,
      title,
      artist: artists[i % artists.length]!,
      album: i % 4 === 0 ? `Album ${1 + (i % 5)}` : '',
      category,
      path: `${category ? `${category}/` : ''}${title}.kfn`,
    })
  }
  return songs
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u

/** Same rules as the server: word prefixes (accents ignored) plus literal symbol terms. */
function matches(song: Song, q: string): boolean {
  const text = `${song.title} ${song.artist} ${song.album}`
  const words = fold(text).split(/[^\p{L}\p{N}]+/u)
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((term) =>
      HAS_WORD_CHARACTER.test(term)
        ? words.some((w) => w.startsWith(fold(term).replace(/[^\p{L}\p{N}]/gu, '')))
        : text.includes(term),
    )
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface FakeBackendOptions {
  songs?: Song[]
  /** Songs to have queued from the start (by index into the catalog); the first one becomes current. */
  queued?: number[]
  screens?: number
  connected?: boolean
  scan?: Partial<ScanStatus>
  /** Simulated network latency for searches. */
  latencyMs?: number
}

/**
 * An in-memory karaoke server for stories. Commands go through the real
 * session reducer, so queueing, skipping and pausing behave like production.
 */
export function createFakeBackend(options: FakeBackendOptions = {}) {
  const songs = options.songs ?? makeCatalog()
  const latency = options.latencyMs ?? 150
  const connected = ref(options.connected ?? true)
  const state = shallowRef<SessionState>({
    ...initialState(),
    screens: options.screens ?? 1,
    scan: { ...initialScan, songCount: songs.length, lastFinishedAt: 1, ...options.scan },
  })
  let nextId = 1

  function dispatch(action: SessionAction): void {
    state.value = reduce(state.value, action)
  }

  function queueItem(song: Song, singer?: string, ball = true): QueueItem {
    return { id: `item-${nextId++}`, song, singer, addedAt: Date.now(), ball }
  }

  for (const index of options.queued ?? []) {
    const song = songs[index]
    if (song) dispatch({ type: 'enqueue', item: queueItem(song, index % 2 ? 'Alex' : undefined) })
  }

  function execute(command: ClientCommand): void {
    switch (command.type) {
      case 'hello':
      case 'ping':
        return
      case 'enqueue': {
        const song = songs.find((s) => s.id === command.songId)
        if (song) dispatch({ type: 'enqueue', item: queueItem(song, command.singer, command.ball ?? true) })
        return
      }
      default:
        dispatch(command)
    }
  }

  /** Called from a component's setup, like useSession; the watcher stops with the component. */
  function connect(role: ClientRole): Session {
    void role
    const view = shallowRef<SessionState | null>(state.value)
    // Clients follow the shared state only while "connected"; offline they keep the last one seen.
    watch([state, connected], () => {
      if (connected.value) view.value = state.value
    })
    return {
      state: view,
      connected: readonly(connected),
      error: ref<string | null>(null),
      send(command) {
        if (!connected.value) return false
        execute(command)
        return true
      },
      report(command: ScreenCommand) {
        if (connected.value) execute(command)
      },
      reconnectNow() {},
    }
  }

  const services: KaraokeServices = {
    connect,
    async searchSongs({ q = '', category = null, offset = 0, limit = 50 }): Promise<SongPage> {
      await delay(latency)
      const hits = songs.filter((s) => (category == null || s.category === category) && matches(s, q))
      return { songs: hits.slice(offset, offset + limit), total: hits.length, offset, limit }
    },
    async getCategories(): Promise<CategoryCount[]> {
      const counts = new Map<string, number>()
      for (const s of songs) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
      return [...counts].map(([category, count]) => ({ category, count }))
    },
    async getInfo(): Promise<ServerInfo> {
      return { publicUrl: 'http://karaokej.local:3000' }
    },
    async fetchSongFile(): Promise<ArrayBuffer> {
      await delay(latency)
      const bytes = makeDemoKfn()
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
  }

  return {
    services,
    /** Story controls. */
    connected,
    state,
    setScreens: (count: number) => dispatch({ type: 'screens', count }),
    setScan: (scan: Partial<ScanStatus>) =>
      dispatch({ type: 'scan', scan: { ...state.value.scan, ...scan } }),
  }
}
