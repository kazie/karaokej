import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSongFile, remoteUrl, searchSongs } from '../src/api'

afterEach(() => vi.unstubAllGlobals())

function captureFetch(): string[] {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ songs: [], total: 0, offset: 0, limit: 50 }))
    }),
  )
  return urls
}

describe('searchSongs', () => {
  it('omits the category for "all" but sends an empty one for the library root', async () => {
    const urls = captureFetch()
    await searchSongs({ q: '', category: null })
    await searchSongs({ category: '' })
    await searchSongs({ q: 'we are', category: 'Anime', offset: 50 })
    expect(urls).toEqual([
      '/api/songs?',
      '/api/songs?category=',
      '/api/songs?q=we+are&category=Anime&offset=50',
    ])
  })
})

describe('remoteUrl', () => {
  const loc = (href: string) => new URL(href) as unknown as Location

  it('prefers the configured public URL', () => {
    expect(
      remoteUrl({ publicUrl: 'http://karaoke.lan', lanAddresses: [] }, loc('http://localhost:5173/screen')),
    ).toBe('http://karaoke.lan/remote')
  })

  it('swaps localhost for the LAN address so phones can connect', () => {
    const info = { publicUrl: null, lanAddresses: ['192.0.2.7'] }
    expect(remoteUrl(info, loc('http://localhost:5173/screen'))).toBe('http://192.0.2.7:5173/remote')
    expect(remoteUrl(info, loc('http://karaoke.lan:3000/screen'))).toBe('http://karaoke.lan:3000/remote')
  })
})

describe('fetchSongFile', () => {
  const ok = () => new Response(new Uint8Array([1, 2, 3]))

  it('retries network errors and server errors, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const bytes = await fetchSongFile('abc', undefined, [0, 0, 0])
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('fails at once on a client error such as a deleted file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 410 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSongFile('abc', undefined, [0, 0])).rejects.toThrow('410')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSongFile('abc', undefined, [0, 0])).rejects.toThrow('Failed to fetch')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops retrying when aborted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = fetchSongFile('abc', controller.signal, [60_000])
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
