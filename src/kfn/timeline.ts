import type { LyricsEffect } from './parseSongIni'

export interface TimedSyllable {
  /** Display text, including a trailing space when a word ends here. */
  text: string
  /** Milliseconds; `Infinity` when the file ran out of sync marks. */
  start: number
  end: number
}

export interface TimedLine {
  index: number
  /** Empty for a blank (paragraph break) line. */
  syllables: TimedSyllable[]
  start: number
  end: number
}

export interface Timeline {
  lines: TimedLine[]
  warnings: string[]
}

/** Longest wipe for the last syllable of a line before a pause. */
export const MAX_TRAILING_SYLLABLE_MS = 1500

/** Split a KaraFun lyric line into syllables: spaces separate words, `/` separates syllables. */
export function splitSyllables(line: string): string[] {
  const words = line.split(' ').filter((w) => w !== '')
  return words.flatMap((word, wi) => {
    const parts = word.split('/').filter((p) => p !== '')
    if (wi < words.length - 1 && parts.length) parts[parts.length - 1] += ' '
    return parts
  })
}

export function buildTimeline(lyrics: Pick<LyricsEffect, 'texts' | 'syncs'>, globalShiftCs = 0): Timeline {
  const warnings: string[] = []
  const toMs = (cs: number) => (cs + globalShiftCs) * 10
  let next = 0

  const lines: TimedLine[] = lyrics.texts.map((text, index) => {
    const syllables = splitSyllables(text).map((s): TimedSyllable => {
      const cs = lyrics.syncs[next++]
      const start = cs === undefined ? Infinity : toMs(cs)
      return { text: s, start, end: start }
    })
    return { index, syllables, start: Infinity, end: Infinity }
  })

  if (next > lyrics.syncs.length) {
    warnings.push(`Lyrics have ${next} syllables but only ${lyrics.syncs.length} sync marks`)
  } else if (next < lyrics.syncs.length) {
    warnings.push(`Lyrics have ${next} syllables but ${lyrics.syncs.length} sync marks`)
  }

  const timed = lines.filter((l) => l.syllables.length > 0)
  timed.forEach((line, li) => {
    const nextLineStart = timed[li + 1]?.syllables[0]?.start ?? Infinity
    line.syllables.forEach((syl, si) => {
      const following = line.syllables[si + 1]?.start
      syl.end =
        following !== undefined
          ? Math.max(syl.start, following)
          : Math.min(nextLineStart, syl.start + MAX_TRAILING_SYLLABLE_MS)
    })
    line.start = line.syllables[0]!.start
    line.end = line.syllables[line.syllables.length - 1]!.end
  })

  // Blank lines sit between their neighbours in time.
  let prevEnd = 0
  for (const line of lines) {
    if (line.syllables.length) prevEnd = line.end
    else line.start = line.end = prevEnd
  }

  return { lines, warnings }
}

/** Index of the syllable being sung on `line` at `timeMs` (0 before the line starts). */
export function syllableIndexAt(line: TimedLine, timeMs: number): number {
  let i = line.syllables.length - 1
  while (i > 0 && line.syllables[i]!.start > timeMs) i--
  return Math.max(0, i)
}

/** Progress of a syllable at `timeMs`, from 0 (not sung) to 1 (sung). */
export function syllableProgress(syl: TimedSyllable, timeMs: number): number {
  if (timeMs <= syl.start) return 0
  if (timeMs >= syl.end) return 1
  return (timeMs - syl.start) / (syl.end - syl.start)
}

/** Index of the line being sung, or else the next one to sing (the last line once the song is over). */
export function focusLineIndex(timeline: Timeline, timeMs: number): number {
  let last = 0
  for (const line of timeline.lines) {
    if (!line.syllables.length) continue
    if (line.end > timeMs) return line.index
    last = line.index
  }
  return last
}

/** Length of the 3-2-1 countdown before a line after a gap. */
const COUNTDOWN_MS = 3000
/** Pauses between lines at least this long count as interludes. */
const INTERLUDE_MIN_MS = 6000

export interface Gap {
  startMs: number
  /** When singing resumes. */
  endMs: number
}

/**
 * The instrumental gaps of a song: the intro before the first line, and
 * pauses of at least {@link INTERLUDE_MIN_MS} between lines. Lines of all
 * tracks count, so a duet only has a gap when nobody sings. Compute once per
 * song and look up with {@link gapAt}.
 */
export function buildGaps(timelines: readonly Timeline[]): Gap[] {
  const sung = timelines
    .flatMap((t) => t.lines)
    .filter((l) => l.syllables.length && Number.isFinite(l.start))
    .sort((a, b) => a.start - b.start)
  if (!sung.length) return []
  const gaps: Gap[] = [{ startMs: 0, endMs: sung[0]!.start }]
  let end = sung[0]!.end
  for (const line of sung.slice(1)) {
    if (line.start - end >= INTERLUDE_MIN_MS) gaps.push({ startMs: end, endMs: line.start })
    end = Math.max(end, line.end)
  }
  return gaps
}

/** The gap `timeMs` falls in; the same object for as long as it lasts. */
export function gapAt(gaps: readonly Gap[], timeMs: number): Gap | null {
  return gaps.find((g) => timeMs >= g.startMs && timeMs < g.endMs) ?? null
}

/** When the 3-2-1 countdown before the end of `gap` starts. */
export const countdownStart = (gap: Gap) => gap.endMs - COUNTDOWN_MS

/** When a line is on screen: from a while before its verse is sung until just after. */
export interface ShowWindow {
  showFrom: number
  hideAfter: number
}

/** Pauses shorter than the lead-in plus this keep a verse together, so lines never blink off briefly. */
const MIN_HIDDEN_MS = 1000
/** How long a verse stays up after its last syllable. */
const LINGER_MS = 1000

const ALWAYS: ShowWindow = { showFrom: -Infinity, hideAfter: Infinity }

/**
 * Each line's {@link ShowWindow}, by line index. Lines are grouped into verses
 * split at pauses of at least `leadMs` + {@link MIN_HIDDEN_MS}; a verse shows
 * `leadMs` before it starts and {@link LINGER_MS} after it ends. Blank and
 * unsynced lines go with the verse before them. `leadMs` 0 shows every line
 * all the time. Compute once per track.
 */
export function lineWindows(timeline: Timeline, leadMs: number): ShowWindow[] {
  if (leadMs <= 0) return timeline.lines.map(() => ALWAYS)
  let verse: ShowWindow | null = null
  let verseEnd = -Infinity
  const windows = timeline.lines.map((line) => {
    if (!line.syllables.length || !Number.isFinite(line.start)) return verse
    if (!verse || line.start - verseEnd >= leadMs + MIN_HIDDEN_MS) {
      verse = { showFrom: line.start - leadMs, hideAfter: 0 }
      verseEnd = -Infinity
    }
    verseEnd = Math.max(verseEnd, line.end)
    verse.hideAfter = verseEnd + LINGER_MS
    return verse
  })
  // Blank lines before the first verse go with it.
  const first = windows.find((w) => w !== null) ?? ALWAYS
  return windows.map((w) => w ?? first)
}

export const shownAt = (window: ShowWindow, timeMs: number): boolean =>
  timeMs >= window.showFrom && timeMs < window.hideAfter
