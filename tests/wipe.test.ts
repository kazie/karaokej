import { describe, expect, it } from 'vitest'
import { ballAt, fillFraction, wipeFront } from '../src/kfn/wipe'
import { buildTimeline } from '../src/kfn/timeline'

// "Ka/ra o/ke": syllables start at 1.0, 1.5, 2.0, 2.5 s (last ends at 4.0 s);
// widths 20, 30, 10, 40 px, so centres are at 10, 35, 55 and 80 px.
const line = buildTimeline({ texts: ['Ka/ra o/ke'], syncs: [100, 150, 200, 250] }).lines[0]!
const edges = [0, 20, 50, 60, 100]
const centres = [10, 35, 55, 80]
const fills = (t: number) =>
  [0, 1, 2, 3].map((i) => +fillFraction(edges, wipeFront(line, edges, t)!, i).toFixed(2))

describe('wipe and bouncing ball', () => {
  it('has each syllable half filled exactly when the ball lands on its centre', () => {
    line.syllables.forEach((syl, i) => {
      expect(ballAt(line, edges, syl.start)).toEqual({ x: centres[i], lift: 0 })
      expect(wipeFront(line, edges, syl.start)).toBe(centres[i])
      expect(fillFraction(edges, centres[i]!, i)).toBe(0.5)
    })
  })

  it('moves the wipe front with the ball between syllables', () => {
    for (const t of [1100, 1250, 1720, 2330, 2900, 3999]) {
      expect(ballAt(line, edges, t)!.x).toBeCloseTo(wipeFront(line, edges, t)!)
    }
    expect(fills(1250)).toEqual([1, 0.08, 0, 0]) // front at 22.5 px, halfway from centre 10 to centre 35
    expect(ballAt(line, edges, 1250)!.lift).toBeCloseTo(1) // top of the bounce
  })

  it('fills the first half of the first syllable just before it is sung', () => {
    expect(fills(0)).toEqual([0, 0, 0, 0])
    expect(fills(750)).toEqual([0, 0, 0, 0]) // lead-in is 250 ms (half the first syllable)
    expect(fills(875)).toEqual([0.25, 0, 0, 0])
    expect(ballAt(line, edges, 875)!.x).toBe(10) // the ball waits on the first centre
  })

  it('finishes the line by the end of the last syllable', () => {
    expect(fills(3250)).toEqual([1, 1, 1, 0.75])
    expect(fills(10_000)).toEqual([1, 1, 1, 1])
    expect(ballAt(line, edges, 10_000)).toEqual({ x: 100, lift: expect.closeTo(0) })
  })

  it('hops in place only during the countdown before the line', () => {
    expect(ballAt(line, edges, -5000)).toEqual({ x: 10, lift: 0 })
    expect(ballAt(line, edges, 500)!.lift).toBeCloseTo(0.6)
  })

  it('needs a measurement for every syllable', () => {
    expect(wipeFront(line, [0, 20], 1000)).toBeNull()
    expect(ballAt(line, [0, 20], 1000)).toBeNull()
  })
})
