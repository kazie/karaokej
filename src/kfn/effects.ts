import { float, kfnColor, parseKfnHex, type AnimAction, type Animation } from './parseSongIni'

/**
 * A value that holds from `startMs` until the next keyframe. Renderers set the
 * value and let a CSS transition of `transitionMs` animate from the previous one.
 */
export interface Keyframe<T> {
  startMs: number
  value: T
  transitionMs: number
  /** CSS easing function. */
  easing: string
}

/** Width and height of the KaraFun canvas that offsets are expressed in. */
const KARAFUN_CANVAS = { width: 800, height: 600 } as const

/** A track that never changes. */
export const still = <T>(value: T): Keyframe<T>[] => [
  { startMs: 0, value, transitionMs: 0, easing: 'linear' },
]

/** Of several keyframes (one per track), the one that started last: it decides how to animate. */
export function latestFrame<T>(...frames: (Keyframe<T> | undefined)[]): Keyframe<T> | undefined {
  return frames.reduce((a, b) => ((b?.startMs ?? -1) > (a?.startMs ?? -1) ? b : a), undefined)
}

/** CSS `transform` for a KaraFun canvas offset, relative to the nearest size container. */
export function canvasTranslate(x = 0, y = 0): string {
  return `translate(${(x / KARAFUN_CANVAS.width) * 100}cqw, ${(y / KARAFUN_CANVAS.height) * 100}cqh)`
}

/** CSS transition for `property` as a keyframe asks. */
export function cssTransition(frame: Keyframe<unknown> | undefined, property: string): string {
  return `${property} ${frame?.transitionMs ?? 0}ms ${frame?.easing ?? 'linear'}`
}

const EASINGS: [RegExp, string][] = [
  [/^linear$/i, 'linear'],
  [/^smooth$/i, 'ease-in-out'],
  [/bounc|falling/i, 'cubic-bezier(0.34, 1.56, 0.64, 1)'],
  [/^bend/i, 'ease-out'],
]

/** Map a KaraFun `TransType` to a CSS easing function. */
export function easingFor(transType: string | undefined): string {
  return EASINGS.find(([pattern]) => pattern.test(transType ?? ''))?.[1] ?? 'ease-in-out'
}

/** The keyframe in effect at `timeMs`: the last one starting at or before it (frames are sorted). */
export function valueAt<T>(frames: readonly Keyframe<T>[], timeMs: number): Keyframe<T> | undefined {
  let lo = 0
  let hi = frames.length - 1
  let found: Keyframe<T> | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid]!.startMs <= timeMs) {
      found = frames[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

type Step<T> = { value: T; transitionCs?: number; easing?: string }

/**
 * Build a keyframe track: the initial value at time 0, then one keyframe per
 * animation action that `pick` understands.
 */
export function buildTrack<T>(
  initial: T,
  animations: readonly Animation[],
  globalShiftCs: number,
  pick: (action: AnimAction) => Step<T> | undefined,
): Keyframe<T>[] {
  const frames = still(initial)
  for (const anim of animations) {
    for (const action of anim.actions) {
      const step = pick(action)
      if (!step) continue
      frames.push({
        startMs: Math.max(0, (anim.timeCs + globalShiftCs) * 10),
        value: step.value,
        transitionMs: Math.max(0, (step.transitionCs ?? 0) * 10),
        easing: step.easing ?? 'linear',
      })
    }
  }
  return frames.sort((a, b) => a.startMs - b.startMs)
}

/** `ChgColX:TargetColor=#RRGGBBAA,FadeTime=cs` → a step with the color mapped by `map`. */
export function fadeStep<T>(
  action: AnimAction,
  type: string,
  map: (hex: string | undefined) => T,
): Step<T> | undefined {
  if (action.type !== type) return undefined
  return { value: map(action.params.TargetColor), transitionCs: float(action.params.FadeTime) }
}

/** `ChgColX:TargetColor=#RRGGBBAA,FadeTime=cs` → a CSS color step. */
export const colorStep = (action: AnimAction, type: string, fallback: string) =>
  fadeStep(action, type, (hex) => kfnColor(hex, fallback))

/** `ChgFloatX:TargetFloat=n,TransTime=cs,TransType=...` → a number step. */
export function floatStep(action: AnimAction, type: string): Step<number> | undefined {
  if (action.type !== type) return undefined
  return {
    value: float(action.params.TargetFloat),
    transitionCs: float(action.params.TransTime),
    easing: easingFor(action.params.TransType),
  }
}

export interface SplitColor {
  /** The color without transparency. */
  color: string
  /** 0..1 */
  alpha: number
}

/** A CSS color from {@link kfnColor} (or `#RRGGBB[AA]`) split into an opaque color and its alpha. */
export function splitAlpha(css: string): SplitColor {
  const hex = parseKfnHex(css)
  if (hex) return { color: `rgb(${hex.r} ${hex.g} ${hex.b})`, alpha: hex.alpha }
  const m = /^rgb\((\d+ \d+ \d+) \/ ([\d.]+)\)$/.exec(css.trim())
  return m ? { color: `rgb(${m[1]})`, alpha: Math.min(1, +m[2]!) } : { color: css, alpha: 1 }
}

export interface ImageColor {
  /** 0..1, from the color's alpha. */
  opacity: number
  /** CSS color to multiply the image with, or null for white (no tint). */
  tint: string | null
}

/** KaraFun `#RRGGBBAA` image color → opacity plus optional multiply tint. */
export function imageColor(value: string | undefined): ImageColor {
  const c = parseKfnHex(value)
  if (!c) return { opacity: 1, tint: null }
  const white = c.r === 255 && c.g === 255 && c.b === 255
  return { opacity: c.alpha, tint: white ? null : `rgb(${c.r} ${c.g} ${c.b})` }
}

/** How a new background picture comes in. */
export type TransitionKind =
  | 'cut'
  | 'crossfade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'zoom'

/** KaraFun `ChgBgImg` `Effect` names → transition; unknown names crossfade. */
const TRANSITIONS: [RegExp, TransitionKind][] = [
  [/^(NoTransition)?$/i, 'cut'],
  [/^AlphaBlending$/i, 'crossfade'],
  // `MoveLeft`: the new picture moves in leftwards, from the right edge.
  [/^Move ?Left$/i, 'slide-left'],
  [/^Move ?Right$/i, 'slide-right'],
  [/^Move ?(Top|Up)$/i, 'slide-up'],
  [/^Move ?(Bottom|Down)$/i, 'slide-down'],
  [/^Wipe ?Left$/i, 'wipe-left'],
  [/^Wipe ?Right$/i, 'wipe-right'],
  [/^Wipe ?(Top|Up)$/i, 'wipe-up'],
  [/^Wipe ?(Bottom|Down)$/i, 'wipe-down'],
  [/zoom/i, 'zoom'],
]

/** The transition for a KaraFun `ChgBgImg` `Effect` name. */
export function transitionKind(effect: string | undefined): TransitionKind {
  return TRANSITIONS.find(([pattern]) => pattern.test(effect?.trim() ?? ''))?.[1] ?? 'crossfade'
}

/** How lyric lines move: scroll up (the usual), scroll down, or stand still a page at a time. */
export type LineMotion = 'up' | 'down' | 'still'

/** KaraFun `Trajectory` name → line motion; unsupported ones (e.g. `CrazyCircles`) scroll up. */
export function lineMotion(trajectory: string | undefined): LineMotion {
  if (/^PlainTopToBottom$/i.test(trajectory ?? '')) return 'down'
  if (/^Still$/i.test(trajectory ?? '')) return 'still'
  return 'up'
}

export interface SelTextEffect {
  /** e.g. `LittleShake`, `JumpOneTime`; `NoEffect` for none. */
  name: string
  /** First `*` parameter, clamped to a sensible range. */
  intensity: number
}

export const NO_SEL_TEXT_EFFECT: SelTextEffect = { name: 'NoEffect', intensity: 1 }

/** `LittleShake*8.000000*1.000000*...` → name and intensity; empty or `NoEffect` → {@link NO_SEL_TEXT_EFFECT}. */
export function selTextEffect(raw: string | undefined): SelTextEffect {
  const [rawName = '', factor] = (raw ?? '').split('*')
  const name = rawName.trim()
  if (!name || name === NO_SEL_TEXT_EFFECT.name) return NO_SEL_TEXT_EFFECT
  return { name, intensity: Math.min(3, Math.max(0.25, float(factor, 1) || 1)) }
}
