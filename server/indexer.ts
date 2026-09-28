import { createHash } from 'node:crypto'
import type { Dir } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type { ScanStatus } from '../src/shared/protocol'
import { KfnTruncatedError, parseKfnHeader } from '../src/kfn/parseKfn'
import { errorMessage } from '../src/shared/errors'
import { folderOf } from '../src/shared/folders'
import { transaction, type Database } from './db/database'
import { initialScan } from '../src/shared/session'
import type { SongRepository, SongRow } from './songs'

const HEADER_READ_SIZES = [64 * 1024, 1024 * 1024]
const BATCH_SIZE = 200
const STAT_CONCURRENCY = 16

export interface FoundFile {
  /** Relative to the library root, with `/` separators. */
  path: string
  absPath: string
  size: number
  mtimeMs: number
}

export function songId(relPath: string): string {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 12)
}

/**
 * Recursively find `.kfn` files, following symlinks but never visiting a directory twice.
 * An unreadable root throws; unreadable subdirectories (e.g. `lost+found`) are skipped.
 */
export async function* walkLibrary(root: string): AsyncGenerator<FoundFile> {
  const seen = new Set<string>()
  async function* walk(dir: string): AsyncGenerator<FoundFile> {
    let entries: Dir
    try {
      const real = await realpath(dir)
      if (seen.has(real)) return
      seen.add(real)
      entries = await opendir(dir)
    } catch (e) {
      if (dir === root) throw e
      return
    }
    const subdirs: string[] = []
    const candidates: string[] = []
    for await (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) subdirs.push(abs)
      else if (entry.isSymbolicLink() || (entry.isFile() && entry.name.toLowerCase().endsWith('.kfn'))) {
        candidates.push(abs)
      }
    }
    // One stat per file (also resolving symlinks), several at a time: each is a round trip on network mounts.
    const stats = await mapLimit(candidates, STAT_CONCURRENCY, (abs) => stat(abs).catch(() => null))
    for (const [i, abs] of candidates.entries()) {
      const s = stats[i]
      if (s?.isDirectory()) subdirs.push(abs)
      else if (s?.isFile() && abs.toLowerCase().endsWith('.kfn')) {
        yield {
          path: relative(root, abs).split(sep).join('/'),
          absPath: abs,
          size: s.size,
          mtimeMs: Math.trunc(s.mtimeMs),
        }
      }
    }
    for (const sub of subdirs) yield* walk(sub)
  }
  yield* walk(root)
}

/** Map with at most `limit` promises in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return results
}

async function readMeta(absPath: string) {
  const fh = await open(absPath, 'r')
  try {
    for (const size of HEADER_READ_SIZES) {
      const buf = new Uint8Array(size)
      const { bytesRead } = await fh.read(buf, 0, size, 0)
      try {
        return parseKfnHeader(buf.subarray(0, bytesRead)).meta
      } catch (e) {
        if (!(e instanceof KfnTruncatedError) || bytesRead < size) throw e
      }
    }
    throw new Error('KFN header is too large')
  } finally {
    await fh.close()
  }
}

export async function indexFile(file: FoundFile, now = Date.now()): Promise<SongRow> {
  const { category, subcategory } = folderOf(file.path)
  const fallbackTitle = basename(file.path).replace(/\.kfn$/i, '')
  const base = {
    id: songId(file.path),
    path: file.path,
    category,
    subcategory,
    size: file.size,
    mtime_ms: file.mtimeMs,
    indexed_at: now,
  }
  try {
    const meta = await readMeta(file.absPath)
    return {
      ...base,
      title: meta.title.trim() || fallbackTitle,
      artist: meta.artist.trim(),
      album: meta.album.trim(),
      error: null,
    }
  } catch (e) {
    return {
      ...base,
      title: fallbackTitle,
      artist: '',
      album: '',
      error: errorMessage(e),
    }
  }
}

export interface IndexerOptions {
  db: Database
  songs: SongRepository
  root: string
  onStatus?: (status: ScanStatus) => void
  /** Parallel header reads; keep modest for network mounts. */
  concurrency?: number
  /** Rows written per transaction. */
  batchSize?: number
}

export interface ScanResult {
  found: number
  added: number
  updated: number
  removed: number
  unchanged: number
}

/** Incremental library indexer: only new or changed files are opened. */
export class Indexer {
  private running: Promise<ScanResult> | null = null
  status: ScanStatus

  constructor(private readonly opts: IndexerOptions) {
    this.status = { ...initialScan, songCount: opts.songs.count() }
  }

  private update(patch: Partial<ScanStatus>): void {
    this.status = { ...this.status, ...patch }
    this.opts.onStatus?.(this.status)
  }

  /** Start a scan, or join the one already running. */
  scan(): Promise<ScanResult> {
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<ScanResult> {
    const { db, songs, root, concurrency = 8, batchSize = BATCH_SIZE } = this.opts
    this.update({ running: true, done: 0, total: 0, lastError: null })
    try {
      const known = new Map(
        (db.prepare('SELECT path, size, mtime_ms FROM songs').all() as unknown as SongRow[]).map((r) => [
          r.path,
          r,
        ]),
      )
      const files: FoundFile[] = []
      for await (const f of walkLibrary(root)) {
        files.push(f)
        if (files.length % 100 === 0) this.update({ total: files.length })
      }
      this.update({ total: files.length })
      if (files.length === 0 && known.size > 0) {
        // Most likely an unmounted network share showing its empty mount point.
        throw new Error(`No .kfn files found in ${root}; keeping the existing index. Is the library mounted?`)
      }

      const result: ScanResult = { found: files.length, added: 0, updated: 0, removed: 0, unchanged: 0 }
      const changed = files.filter((f) => {
        const row = known.get(f.path)
        if (row && row.size === f.size && row.mtime_ms === f.mtimeMs) {
          result.unchanged++
          return false
        }
        if (row) result.updated++
        else result.added++
        return true
      })
      let done = result.unchanged
      this.update({ done })

      const upsert = db.prepare(`
        INSERT INTO songs (id, path, category, subcategory, title, artist, album, size, mtime_ms, indexed_at, error)
        VALUES (:id, :path, :category, :subcategory, :title, :artist, :album, :size, :mtime_ms, :indexed_at, :error)
        ON CONFLICT (path) DO UPDATE SET
          category = excluded.category, subcategory = excluded.subcategory,
          title = excluded.title, artist = excluded.artist,
          album = excluded.album, size = excluded.size, mtime_ms = excluded.mtime_ms,
          indexed_at = excluded.indexed_at, error = excluded.error`)
      // Read headers in parallel one chunk at a time, then write each chunk in a single transaction.
      for (let i = 0; i < changed.length; i += batchSize) {
        const rows = await mapLimit(changed.slice(i, i + batchSize), concurrency, (f) => indexFile(f))
        transaction(db, () => rows.forEach((r) => upsert.run({ ...r })))
        done += rows.length
        this.update({ done, songCount: songs.count() })
      }

      const present = new Set(files.map((f) => f.path))
      const gone = [...known.keys()].filter((p) => !present.has(p))
      const remove = db.prepare('DELETE FROM songs WHERE path = ?')
      transaction(db, () => gone.forEach((p) => remove.run(p)))
      result.removed = gone.length

      this.update({ running: false, done, songCount: songs.count(), lastFinishedAt: Date.now() })
      return result
    } catch (e) {
      this.update({ running: false, lastError: errorMessage(e) })
      throw e
    }
  }
}
