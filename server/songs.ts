import type { CategoryCount, Song, SongPage } from '../src/shared/protocol'
import type { Database } from './db/database'

export interface SongRow {
  id: string
  path: string
  category: string
  title: string
  artist: string
  album: string
  size: number
  mtime_ms: number
  indexed_at: number
  error: string | null
}

export interface SearchOptions {
  q?: string
  /** Omit for all categories; `''` selects songs in the library root. */
  category?: string
  offset?: number
  limit?: number
}

export const MAX_PAGE_SIZE = 50

export function toSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    category: row.category,
    path: row.path,
  }
}

export interface ParsedSearch {
  /** FTS5 query for the word terms, each matched as a prefix; null when there are none. */
  match: string | null
  /** Terms without letters or digits (e.g. `&`, `-`), matched as literal substrings. */
  literals: string[]
}

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * Split user input into full-text terms and literal symbol terms. The FTS
 * tokenizer drops punctuation, so a term like `&` could never match otherwise.
 */
export function parseSearch(q: string): ParsedSearch {
  const terms = q.split(/\s+/).filter((t) => t.length > 0)
  const words = terms.filter((t) => HAS_WORD_CHARACTER.test(t))
  return {
    match: words.length ? words.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ') : null,
    literals: terms.filter((t) => !HAS_WORD_CHARACTER.test(t)),
  }
}

/** A LIKE pattern matching `text` anywhere, with LIKE wildcards escaped. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export class SongRepository {
  private readonly countStmt
  private readonly byIdStmt
  private readonly categoriesStmt

  constructor(private readonly db: Database) {
    this.countStmt = db.prepare('SELECT count(*) AS n FROM songs')
    this.byIdStmt = db.prepare('SELECT * FROM songs WHERE id = ?')
    this.categoriesStmt = db.prepare(
      'SELECT category, count(*) AS count FROM songs GROUP BY category ORDER BY category COLLATE NOCASE',
    )
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n
  }

  byId(id: string): SongRow | undefined {
    return this.byIdStmt.get(id) as SongRow | undefined
  }

  categories(): CategoryCount[] {
    return this.categoriesStmt.all() as unknown as CategoryCount[]
  }

  search({ q = '', category, offset = 0, limit = MAX_PAGE_SIZE }: SearchOptions = {}): SongPage {
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || MAX_PAGE_SIZE))
    offset = Math.max(0, Math.trunc(offset) || 0)
    const { match, literals } = parseSearch(q)
    const where: string[] = []
    const params: string[] = []
    if (match) {
      where.push('songs_fts MATCH ?')
      params.push(match)
    }
    for (const literal of literals) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\' OR s.album LIKE ? ESCAPE '\\')")
      const pattern = containsPattern(literal)
      params.push(pattern, pattern, pattern)
    }
    // An empty string is a real category: songs directly in the library root.
    if (category !== undefined) {
      where.push('s.category = ?')
      params.push(category)
    }
    const from = match ? 'songs_fts JOIN songs s ON s.rowid = songs_fts.rowid' : 'songs s'
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const order = match
      ? 'bm25(songs_fts, 10.0, 5.0, 2.0, 1.0), s.title COLLATE NOCASE'
      : 's.artist COLLATE NOCASE, s.title COLLATE NOCASE'

    const total = (
      this.db.prepare(`SELECT count(*) AS n FROM ${from} ${whereSql}`).get(...params) as { n: number }
    ).n
    const rows = this.db
      .prepare(`SELECT s.* FROM ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as SongRow[]
    return { songs: rows.map(toSong), total, offset, limit }
  }
}
