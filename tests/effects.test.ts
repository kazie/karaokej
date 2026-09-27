import { describe, expect, it } from 'vitest'
import {
  buildTrack,
  easingFor,
  floatStep,
  imageColor,
  NO_SEL_TEXT_EFFECT,
  selTextEffect,
  valueAt,
} from '../src/kfn/effects'
import { parseAnimation } from '../src/kfn/parseSongIni'

const frames = [
  { startMs: 0, value: 'a', transitionMs: 0, easing: 'linear' },
  { startMs: 1000, value: 'b', transitionMs: 500, easing: 'ease-in-out' },
  { startMs: 5000, value: 'c', transitionMs: 0, easing: 'linear' },
]

describe('valueAt', () => {
  it('returns the last keyframe at or before the time', () => {
    expect(valueAt(frames, -1)).toBeUndefined()
    expect(valueAt(frames, 0)?.value).toBe('a')
    expect(valueAt(frames, 999)?.value).toBe('a')
    expect(valueAt(frames, 1000)?.value).toBe('b')
    expect(valueAt(frames, 4999)?.value).toBe('b')
    expect(valueAt(frames, 1e9)?.value).toBe('c')
    expect(valueAt([], 0)).toBeUndefined()
  })
})

describe('easingFor', () => {
  it('maps KaraFun TransType names to CSS easings', () => {
    expect(easingFor('Linear')).toBe('linear')
    expect(easingFor('Smooth')).toBe('ease-in-out')
    expect(easingFor('Bounce3')).toMatch(/cubic-bezier/)
    expect(easingFor('FallingBouncing')).toMatch(/cubic-bezier/)
    expect(easingFor('Bend5')).toBe('ease-out')
    expect(easingFor(undefined)).toBe('ease-in-out')
  })
})

describe('buildTrack', () => {
  it('turns animations into sorted keyframes in ms, with the global shift applied', () => {
    const anims = [
      parseAnimation('500|ChgFloatDepth:TargetFloat=-2,TransTime=10,TransType=Linear')!,
      parseAnimation(
        '100|ChgFloatDepth:TargetFloat=-1,TransTime=0,TransType=FallingBouncing|ChgColColor:TargetColor=#FFFFFF,FadeTime=0',
      )!,
    ]
    const track = buildTrack(0, anims, 10, (a) => floatStep(a, 'ChgFloatDepth'))
    expect(track.map((f) => [f.startMs, f.value, f.transitionMs])).toEqual([
      [0, 0, 0],
      [1100, -1, 0],
      [5100, -2, 100],
    ])
    expect(track[1]!.easing).toMatch(/cubic-bezier/)
  })
})

describe('imageColor / selTextEffect', () => {
  it('reads opacity and tint from #RRGGBBAA', () => {
    expect(imageColor('#FFFFFFFF')).toEqual({ opacity: 1, tint: null })
    expect(imageColor('#FFFFFF80').opacity).toBeCloseTo(0.502, 2)
    expect(imageColor('#FF000080').tint).toBe('rgb(255 0 0)')
    expect(imageColor('junk')).toEqual({ opacity: 1, tint: null })
  })

  it('reads the effect name and clamps its intensity', () => {
    expect(selTextEffect('LittleShake*8.000000*1.000000*1*1')).toEqual({ name: 'LittleShake', intensity: 3 })
    expect(selTextEffect('JumpOneTime*2.000000')).toEqual({ name: 'JumpOneTime', intensity: 2 })
    expect(selTextEffect('')).toBe(NO_SEL_TEXT_EFFECT)
    expect(selTextEffect('NoEffect*1.000000*1.000000*1*1')).toBe(NO_SEL_TEXT_EFFECT)
  })
})
