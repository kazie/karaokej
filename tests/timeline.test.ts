import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  buildGaps,
  gapAt,
  focusLineIndex,
  MAX_TRAILING_SYLLABLE_MS,
  splitSyllables,
  syllableProgress,
} from '../src/kfn/timeline'

const lyrics = (texts: string[], syncs: number[]) => ({ texts, syncs })

describe('splitSyllables', () => {
  it('splits on slashes and spaces, keeping word spacing', () => {
    expect(splitSyllables('A/ka/i ho/p/pe')).toEqual(['A', 'ka', 'i ', 'ho', 'p', 'pe'])
    expect(splitSyllables('One Pie/ce')).toEqual(['One ', 'Pie', 'ce'])
    expect(splitSyllables('  double  space ')).toEqual(['double ', 'space'])
    expect(splitSyllables('')).toEqual([])
  })
})

describe('buildTimeline', () => {
  const t = buildTimeline(lyrics(['Ka/ra o/ke', '', 'O/kej'], [100, 150, 200, 250, 1000, 1040]))

  it('assigns centisecond syncs as millisecond starts in order', () => {
    expect(t.warnings).toEqual([])
    expect(t.lines[0]!.syllables.map((s) => [s.text, s.start, s.end])).toEqual([
      ['Ka', 1000, 1500],
      ['ra ', 1500, 2000],
      ['o', 2000, 2500],
      ['ke', 2500, 2500 + MAX_TRAILING_SYLLABLE_MS],
    ])
    expect(t.lines[0]).toMatchObject({ start: 1000, end: 4000 })
  })

  it('places blank lines after the previous line', () => {
    expect(t.lines[1]).toMatchObject({ syllables: [], start: 4000, end: 4000 })
  })

  it('does not let a trailing syllable overlap the next line', () => {
    const tight = buildTimeline(lyrics(['a', 'b'], [100, 120]))
    expect(tight.lines[0]!.end).toBe(1200)
    expect(tight.lines[1]!.end).toBe(1200 + MAX_TRAILING_SYLLABLE_MS)
  })

  it('applies the global shift', () => {
    expect(buildTimeline(lyrics(['a'], [100]), -10).lines[0]!.start).toBe(900)
  })

  it('warns about sync count mismatches', () => {
    const missing = buildTimeline(lyrics(['a/b/c'], [100]))
    expect(missing.warnings[0]).toMatch(/3 syllables but only 1/)
    expect(missing.lines[0]!.syllables[2]!.start).toBe(Infinity)
    expect(buildTimeline(lyrics(['a'], [1, 2])).warnings[0]).toMatch(/1 syllables but 2/)
  })
})

describe('syllableProgress / focusLineIndex', () => {
  const t = buildTimeline(lyrics(['a b', 'c'], [100, 200, 500]))

  it('interpolates syllable progress', () => {
    const syl = t.lines[0]!.syllables[0]!
    expect(syllableProgress(syl, 0)).toBe(0)
    expect(syllableProgress(syl, 1500)).toBe(0.5)
    expect(syllableProgress(syl, 5000)).toBe(1)
  })

  it('finds the line in focus', () => {
    expect(focusLineIndex(t, 0)).toBe(0)
    expect(focusLineIndex(t, 2500)).toBe(0)
    // After line 0 ends, focus moves on to the next line before it starts.
    expect(focusLineIndex(t, 4000)).toBe(1)
    expect(focusLineIndex(t, 60_000)).toBe(1)
  })
})

describe('buildGaps / gapAt', () => {
  const findGap = (timelines: Parameters<typeof buildGaps>[0], t: number) => gapAt(buildGaps(timelines), t)

  // Syllables: a 1.0–1.5 s, b 1.5–3.0 s (last of its line, capped at +1.5 s),
  // then c 12.0–13.5 s and d 14.0–15.5 s.
  const t = buildTimeline(lyrics(['a b', 'c', 'd'], [100, 150, 1200, 1400]))

  it('reports the intro before the first line', () => {
    expect(findGap([t], 0)).toEqual({ startMs: 0, endMs: 1000 })
    expect(findGap([t], 999)).toEqual({ startMs: 0, endMs: 1000 })
  })

  it('reports long pauses between lines as interludes', () => {
    expect(findGap([t], 1200)).toBeNull() // singing
    expect(findGap([t], 3000)).toEqual({ startMs: 3000, endMs: 12000 })
    expect(findGap([t], 11999)).toEqual({ startMs: 3000, endMs: 12000 })
    expect(findGap([t], 12000)).toBeNull()
  })

  it('ignores short pauses and the time after the last line', () => {
    expect(findGap([t], 13700)).toBeNull() // 0.5 s between c and d
    expect(findGap([t], 60_000)).toBeNull()
  })

  it('only counts a gap when no track is singing', () => {
    const other = buildTimeline(lyrics(['x'], [700])) // 7.0–8.5 s, inside the solo gap
    expect(findGap([t, other], 5000)).toBeNull() // 3.0–7.0 s is shorter than an interlude
    expect(findGap([t, other], 9000)).toBeNull() // 8.5–12.0 s is too
    expect(findGap([t, other], 500)).toEqual({ startMs: 0, endMs: 1000 })
  })

  it('returns the same object for as long as a gap lasts', () => {
    const gaps = buildGaps([t])
    expect(gapAt(gaps, 4000)).toBe(gapAt(gaps, 9000))
  })

  it('handles songs without lyrics', () => {
    expect(findGap([buildTimeline(lyrics([], []))], 0)).toBeNull()
    expect(findGap([], 0)).toBeNull()
  })
})
