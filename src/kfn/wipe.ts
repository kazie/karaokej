import { syllableIndexAt, syllableProgress, type TimedLine } from './timeline'

export interface BallPosition {
  /** Horizontal position in px, relative to the line. */
  x: number
  /** Height above the text, 0..1 (scaled to the font by the renderer). */
  lift: number
}

/** How long before a line the ball starts hopping in place. */
const WAIT_HOP_MS = 3000
/** Longest lead-in for filling the first half of a line's first syllable. */
const MAX_LEAD_IN_MS = 500

const centerOf = (edges: readonly number[], i: number) => (edges[i]! + edges[i + 1]!) / 2
const clamp01 = (p: number) => Math.min(1, Math.max(0, p))
const lerp = (a: number, b: number, p: number) => a + (b - a) * clamp01(p)

/**
 * The color wipe's front edge travels from syllable centre to syllable centre,
 * so each syllable is half filled at its start time, which is also when the
 * bouncing ball lands on it.
 *
 * `edges` are the syllables' left edges plus the right edge of the last one
 * (syllables sit edge to edge, trailing spaces included). Returns the front's
 * x position in px, relative to the line, or null if `edges` doesn't fit.
 */
export function wipeFront(line: TimedLine, edges: readonly number[], timeMs: number): number | null {
  const n = line.syllables.length
  if (!n || edges.length !== n + 1) return null
  const step = stepAt(line, timeMs)
  if (!step) {
    // Lead-in: fill the first half of the first syllable just before it's sung.
    const first = line.syllables[0]!
    const lead = Math.min((first.end - first.start) / 2, MAX_LEAD_IN_MS)
    return lerp(edges[0]!, centerOf(edges, 0), lead > 0 ? 1 - (first.start - timeMs) / lead : 0)
  }
  // Centre to centre; the last syllable goes from its centre to the end of the line.
  const to = step.last ? edges[n]! : centerOf(edges, step.i + 1)
  return lerp(centerOf(edges, step.i), to, step.p)
}

/**
 * The step the wipe and the ball are on: from syllable `i`'s start to the
 * next one's (or to the end of the last syllable), with progress `p` 0..1.
 * Null before the line starts. Shared so the ball and the wipe move as one.
 */
function stepAt(line: TimedLine, timeMs: number): { i: number; p: number; last: boolean } | null {
  const syls = line.syllables
  if (!syls.length || timeMs < syls[0]!.start) return null
  const i = syllableIndexAt(line, timeMs)
  const from = syls[i]!.start
  const next = syls[i + 1]
  if (!next) return { i, p: syllableProgress(syls[i]!, timeMs), last: true }
  return { i, p: next.start > from ? clamp01((timeMs - from) / (next.start - from)) : 1, last: false }
}

/** How much of syllable `index` the wipe front covers, 0..1. */
export function fillFraction(edges: readonly number[], front: number, index: number): number {
  const left = edges[index]!
  const width = edges[index + 1]! - left
  return width > 0 ? clamp01((front - left) / width) : front >= left ? 1 : 0
}

/**
 * Where the bouncing ball is at `timeMs` on `line`: it lands on each
 * syllable's centre as the syllable starts, arcing in between, and rides the
 * front of the wipe (see {@link wipeFront}).
 */
export function ballAt(line: TimedLine, edges: readonly number[], timeMs: number): BallPosition | null {
  const front = wipeFront(line, edges, timeMs)
  if (front === null) return null
  const step = stepAt(line, timeMs)
  if (!step) {
    // Waiting on the first syllable, hopping during the countdown.
    const left = line.syllables[0]!.start - timeMs
    const hop = left < WAIT_HOP_MS ? Math.abs(Math.sin((Math.PI * left) / 1000)) * 0.6 : 0
    return { x: centerOf(edges, 0), lift: hop }
  }
  // A full bounce between syllables; a smaller hop off the end of the line.
  return { x: front, lift: Math.sin(Math.PI * step.p) * (step.last ? 0.4 : 1) }
}
