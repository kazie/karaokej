import type { CategoryCount, ServerInfo, SongPage } from './shared/protocol'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const getInfo = () => getJson<ServerInfo>('/api/info')

export const getCategories = () => getJson<CategoryCount[]>('/api/categories')

export function searchSongs(
  params: {
    q?: string
    /** `null`/omitted for all categories; `''` for songs in the library root. */
    category?: string | null
    /** Only with a category: `null`/omitted for the whole folder; `''` for songs directly in it. */
    subcategory?: string | null
    offset?: number
    limit?: number
  },
  signal?: AbortSignal,
): Promise<SongPage> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.category != null) {
    query.set('category', params.category)
    if (params.subcategory != null) query.set('subcategory', params.subcategory)
  }
  if (params.offset) query.set('offset', String(params.offset))
  if (params.limit) query.set('limit', String(params.limit))
  return getJson<SongPage>(`/api/songs?${query}`, signal)
}

/** Waits between download attempts; a short Wi-Fi drop shouldn't skip the song. */
export const SONG_RETRY_DELAYS_MS = [1_000, 3_000, 7_000]

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Could not load song (${status})`)
  }
}

/** Download a song, retrying network failures and server errors; 4xx (e.g. a deleted file) fails at once. */
export async function fetchSongFile(
  songId: string,
  signal?: AbortSignal,
  retryDelaysMs = SONG_RETRY_DELAYS_MS,
): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(songId)}/file`, { signal })
      if (!res.ok) throw new HttpError(res.status)
      return await res.arrayBuffer()
    } catch (e) {
      const retryable = !(e instanceof HttpError && e.status < 500) && !signal?.aborted
      const delay = retryDelaysMs[attempt]
      if (!retryable || delay === undefined) throw e
      await sleep(delay, signal)
    }
  }
}

/** The URL phones should open: the configured public URL, else the screen's own origin. */
export function remoteUrl(info: Pick<ServerInfo, 'publicUrl'> | null, location: Location): string {
  return `${info?.publicUrl ?? location.origin}/remote`
}
