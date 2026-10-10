<script lang="ts">
import { ref } from 'vue'
import type { Timeline } from '../kfn/timeline'

/** One canvas for measuring lyrics, shared by every lyrics view. */
let canvas: CanvasRenderingContext2D | null | undefined

/** Line widths per timeline and font, so a band that comes and goes isn't measured again. */
let widthCache = new WeakMap<Timeline, Map<string, number[]>>()

/** Bumped when web fonts finish loading: widths measured before then used a fallback font. */
const fontLoads = ref(0)
let watchingFonts = false

/** Each line's width in em, in bold `family`. Reactive to font loads when called from a computed. */
function lineWidthsInEm(timeline: Timeline, family: string): number[] {
  void fontLoads.value
  if (!watchingFonts) {
    watchingFonts = true
    document.fonts?.addEventListener('loadingdone', () => {
      widthCache = new WeakMap()
      fontLoads.value++
    })
  }
  const byFont = widthCache.get(timeline) ?? new Map<string, number[]>()
  widthCache.set(timeline, byFont)
  let widths = byFont.get(family)
  if (!widths) {
    canvas ??= document.createElement('canvas').getContext('2d')
    widths = timeline.lines.map((line) => {
      const text = line.syllables.map((s) => s.text).join('')
      if (!canvas) return text.length * 0.6
      canvas.font = `bold 100px '${family}', Arial, sans-serif`
      return canvas.measureText(text).width / 100
    })
    byFont.set(family, widths)
  }
  return widths
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useKeyframe, type Clock } from '../composables/useKeyframe'
import { canvasTranslate, cssTransition, latestFrame, lineMotion, NO_SEL_TEXT_EFFECT } from '../kfn/effects'
import { ballAt, wipeFront } from '../kfn/wipe'
import type { LyricsTrack } from '../kfn/song'
import { cssRgb, parseColor, type KfnRgba } from '../kfn/parseSongIni'
import {
  focusLineIndex,
  lineWindows,
  pageOf,
  shownAt,
  syllableProgress,
  type TimedLine,
} from '../kfn/timeline'
import type { HighlightMode, OutlineWidth } from '../shared/protocol'

/**
 * Scrolling lyrics for one track. Sizes use container query units, so the
 * nearest `container-type: size` ancestor (the player stage) defines the scale.
 */
const props = withDefaults(
  defineProps<{
    track: LyricsTrack
    /** Current playback position (ms). */
    clock: Clock
    /**
     * Font height in % of the stage height per KaraFun font point. On narrow
     * (portrait) stages the width limits the size instead.
     */
    fontScale?: number
    /** Fewer lines around the one in focus, for sharing the stage with other tracks. */
    compact?: boolean
    /** Bounce a ball over the syllables of the line being sung. */
    ball?: boolean
    /** Show a verse this long (ms) before it is sung; 0 shows the lyrics all the time. */
    leadInMs?: number
    /** Fill the sung color in with a smooth wipe, or a whole syllable at a time. */
    highlight?: HighlightMode
    /** Outline thickness, relative to the song's own `FrameType`. */
    outline?: OutlineWidth
  }>(),
  { fontScale: 0.3, compact: false, ball: false, leadInMs: 0, highlight: 'wipe', outline: 'normal' },
)

/** Lines shown before and after the one in focus, where the focus line sits (% of height), and lines per `Still` page. */
const LAYOUT = {
  normal: { before: 2, after: 3, anchor: 45, page: 4 },
  compact: { before: 1, after: 1, anchor: 30, page: 2 },
}
/** Share of the stage width a line may take before it is shrunk. */
const MAX_LINE_WIDTH_CQW = 92

const layout = computed(() => (props.compact ? LAYOUT.compact : LAYOUT.normal))
const lines = computed(() => props.track.timeline.lines)
const style = computed(() => props.track.style)

/** Each line's width in em, measured once per track in the song's own font. */
const lineWidthsEm = computed(() => lineWidthsInEm(props.track.timeline, style.value.fontFamily))

const focusIndex = computed(() => focusLineIndex(props.track.timeline, props.clock()))
const focusLine = computed(() => lines.value[focusIndex.value])

/** When each line is on screen, so lyrics don't sit there through long pauses. */
const windows = computed(() => lineWindows(props.track.timeline, props.leadInMs))
const shown = (line: TimedLine) => shownAt(windows.value[line.index]!, props.clock())

const trajectory = useKeyframe(() => props.track.effects.trajectory, props.clock)
/** How lines move; songs may switch it mid-song. */
const motion = computed(() => lineMotion(trajectory.value?.value))

/**
 * The lines on screen (indices `from` to `to`) and the line position the
 * scroller centres on the anchor. Scrolling lyrics show lines around the
 * focus line; `Still` lyrics show its page, which only changes when the
 * focus moves past it. `fadeOut` lines before the range stay rendered, so
 * lines leaving the screen can fade out (a whole page for still lyrics).
 */
const range = computed(() => {
  if (motion.value === 'still') {
    const { start, end } = pageOf(props.track.timeline, focusIndex.value, layout.value.page)
    return { from: start, to: end, centre: (start + end) / 2, fadeOut: layout.value.page }
  }
  const { before, after } = layout.value
  const focus = focusIndex.value
  return { from: focus - before, to: focus + after, centre: focus, fadeOut: 1 }
})

/** Only lines in or next to the range are rendered (invisible ones let lines fade in and out). */
const windowLines = computed(() => {
  const { from, to, fadeOut } = range.value
  return lines.value.slice(Math.max(0, from - fadeOut), to + 2)
})

/** Outline thickness per KaraFun `FrameN` level. */
const OUTLINE_EM_PER_LEVEL = 0.025
const OUTLINE_SCALE: Record<OutlineWidth, number> = { thin: 0.6, normal: 1, thick: 1.5, extra: 2.2 }

/**
 * Colors of one layer (sung or unsung text). The layer is drawn with opaque
 * text and faded as a whole to the text's transparency, so translucent text
 * shows the background, never the outline under it (half the outline lies
 * inside the glyphs). An outline more transparent than the text keeps the
 * difference; one more opaque fades with the text. Invisible text leaves just
 * the outline.
 */
function layerPaint(text = 'rgb(255 255 255)', frame = 'rgb(0 0 0)') {
  // Song colors parse back to channels; any other CSS color (e.g. from a story) is opaque.
  const t = parseColor(text)
  const f = parseColor(frame)
  const textAlpha = t?.alpha ?? 1
  const opacity = textAlpha > 0 ? textAlpha : (f?.alpha ?? 1)
  const rel = (css: string, c: KfnRgba | null) =>
    c && opacity > 0 ? cssRgb(c, Math.min(1, c.alpha / opacity)) : css
  return { text: rel(text, t), frame: rel(frame, f), opacity }
}

// Each animated property reads its own keyframe, so the root style below only
// changes at a song's keyframes, not on every frame (see useKeyframe).
const e = () => props.track.effects
const activeColor = useKeyframe(() => e().activeColor, props.clock)
const inactiveColor = useKeyframe(() => e().inactiveColor, props.clock)
const frameColor = useKeyframe(() => e().frameColor, props.clock)
const inactiveFrameColor = useKeyframe(() => e().inactiveFrameColor, props.clock)
const offsetX = useKeyframe(() => e().offsetX, props.clock)
const offsetY = useKeyframe(() => e().offsetY, props.clock)
const selText = useKeyframe(() => e().selText, props.clock)
const selEffect = computed(() => selText.value?.value ?? NO_SEL_TEXT_EFFECT)

const rootStyle = computed(() => {
  const colors = [activeColor.value, inactiveColor.value, frameColor.value, inactiveFrameColor.value]
  const move = latestFrame(offsetX.value, offsetY.value)
  const sung = layerPaint(activeColor.value?.value, frameColor.value?.value)
  const unsung = layerPaint(inactiveColor.value?.value, inactiveFrameColor.value?.value)
  return {
    '--font-family': `'${style.value.fontFamily}', Arial, sans-serif`,
    '--font-size': `min(${style.value.fontSize * props.fontScale}cqh, ${style.value.fontSize * props.fontScale * 1.1}cqw)`,
    '--active': activeColor.value?.value,
    '--frame': frameColor.value?.value,
    '--sung-text': sung.text,
    '--sung-frame': sung.frame,
    '--sung-opacity': sung.opacity,
    '--unsung-text': unsung.text,
    '--unsung-frame': unsung.frame,
    '--unsung-opacity': unsung.opacity,
    '--outline': `${style.value.frameWidth * OUTLINE_EM_PER_LEVEL * OUTLINE_SCALE[props.outline]}em`,
    '--color-fade': `${latestFrame(...colors)?.transitionMs ?? 0}ms`,
    '--sel-intensity': selEffect.value.intensity,
    '--align': style.value.alignment,
    '--aspect': style.value.aspectRatio,
    '--anchor': `${layout.value.anchor}%`,
    transform: canvasTranslate(offsetX.value?.value, offsetY.value?.value),
    transition: cssTransition(move, 'transform'),
  }
})

// --- wipe and bouncing ball ----------------------------------------------------

const root = ref<HTMLElement>()
/** Measured syllable edges (px, relative to the line) of one line: left edges plus the last right edge. */
const measured = shallowRef<{ line: TimedLine; edges: number[] } | null>(null)
/** Measured edges of the line in focus (null until measured, e.g. before first render). */
const edges = computed(() =>
  measured.value && measured.value.line === focusLine.value ? measured.value.edges : null,
)

let resizeObserver: ResizeObserver | undefined
let observedLayer: Element | null = null

/** Measure the focus line's syllables; re-measured on line changes, resizes and font loads. */
function measure(): void {
  const line = focusLine.value
  const layer = line
    ? (root.value?.querySelector(`.line[data-index="${line.index}"] .base .text`) ?? null)
    : null
  const els = layer ? [...layer.querySelectorAll<HTMLElement>('.syl')] : []
  const last = els[els.length - 1]
  measured.value =
    line && last
      ? { line, edges: [...els.map((el) => el.offsetLeft), last.offsetLeft + last.offsetWidth] }
      : null
  if (layer !== observedLayer) {
    if (observedLayer) resizeObserver?.unobserve(observedLayer)
    if (layer) resizeObserver?.observe(layer)
    observedLayer = layer
  }
}

// A late-loading font changes glyph widths without resizing the line's box.
const remeasure = () => measure()
onMounted(() => {
  resizeObserver = new ResizeObserver(remeasure)
  measure()
  document.fonts?.addEventListener('loadingdone', remeasure)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.fonts?.removeEventListener('loadingdone', remeasure)
})
// Right after the DOM update, before the browser paints the new line.
watch([focusLine, () => props.fontScale, style], measure, { flush: 'post' })

/**
 * Front edge of the color wipe on the line being sung. It travels from
 * syllable centre to centre, so a syllable is half filled as it starts (and as
 * the bouncing ball lands on it).
 */
const front = computed(() =>
  focusLine.value && edges.value ? wipeFront(focusLine.value, edges.value, props.clock()) : null,
)

const ballPosition = computed(() =>
  props.ball && focusLine.value && edges.value && shown(focusLine.value)
    ? ballAt(focusLine.value, edges.value, props.clock())
    : null,
)

/**
 * CSS class animating the syllable being sung, per the song's selected-text
 * effect. Unknown names have no `.sel-*` rule and do nothing.
 */
function selClass(line: TimedLine, si: number): string | undefined {
  return line.index === focusIndex.value && si === selSyllable.value
    ? `sel sel-${selEffect.value.name}`
    : undefined
}

/** The focus line's syllable being sung, when the song has a selected-text effect for it. */
const selSyllable = computed(() => {
  const line = focusLine.value
  if (selEffect.value === NO_SEL_TEXT_EFFECT || !line || lineState(line) !== 'current') return null
  const t = props.clock()
  const si = line.syllables.findIndex((syl) => {
    const p = syllableProgress(syl, t)
    return p > 0 && p < 1
  })
  return si < 0 ? null : si
})

function visible(line: TimedLine): boolean {
  return line.index >= range.value.from && line.index <= range.value.to && shown(line)
}

function lineState(line: TimedLine): 'past' | 'current' | 'future' {
  const t = props.clock()
  if (line.end <= t) return 'past'
  if (line.start <= t) return 'current'
  return 'future'
}

/** Past either end of a line, by the room the layers' clip-paths leave (`--bleed`). */
const ALL_SUNG = 'calc(100% + var(--bleed))'
const NONE_SUNG = 'calc(-1 * var(--bleed))'

/** The outline copy under the text, unless the song has no outline (or shadow) at all. */
const copies = computed(() =>
  style.value.frameWidth > 0 || style.value.frameShadow ? ['stroke', 'text'] : ['text'],
)

/**
 * Where the sung part of `line` ends, as a CSS length from the line's left
 * edge: the sung layer shows left of it and the unsung layer right of it, so
 * translucent text never has the other layer under it.
 */
function sungUntil(line: TimedLine): string {
  const state = lineState(line)
  if (state !== 'current') return state === 'past' ? ALL_SUNG : NONE_SUNG
  if (line.index !== focusIndex.value || !edges.value) return NONE_SUNG
  if (props.highlight === 'instant') {
    const started = line.syllables.filter((s) => props.clock() >= s.start).length
    if (started === 0) return NONE_SUNG
    return started === line.syllables.length ? ALL_SUNG : `${edges.value[started]}px`
  }
  return front.value === null ? NONE_SUNG : `${front.value}px`
}
</script>

<template>
  <div
    ref="root"
    class="lyrics"
    :class="[`motion-${motion}`, { shadow: style.frameShadow, 'no-fade': !style.fade }]"
    :style="rootStyle"
  >
    <div class="scroller" :style="{ '--focus': range.centre }">
      <p
        v-for="line in windowLines"
        :key="line.index"
        class="line"
        :data-index="line.index"
        :class="[lineState(line), { hidden: !visible(line) }]"
        :style="{
          '--index': line.index,
          '--sung-until': sungUntil(line),
          '--fit': `${MAX_LINE_WIDTH_CQW / Math.max((lineWidthsEm[line.index] ?? 1) * style.aspectRatio, 0.01)}cqw`,
        }"
      >
        <!-- Stretched as the song asks; measurements, the wipe and the ball are all inside, so they stretch along. -->
        <span class="stretch">
          <!-- Each layer: an outline copy of the text under the text itself, clipped at the wipe. -->
          <span
            v-for="layer in ['base', 'fill']"
            :key="layer"
            class="layer"
            :class="layer"
            :aria-hidden="layer === 'fill' || undefined"
          >
            <span
              v-for="copy in copies"
              :key="copy"
              class="copy"
              :class="copy"
              :aria-hidden="copy === 'stroke' || undefined"
            >
              <span v-for="(syl, si) in line.syllables" :key="si" class="syl" :class="selClass(line, si)">{{
                syl.text
              }}</span>
            </span>
          </span>
          <span
            v-if="line.index === focusIndex && ballPosition"
            class="ball"
            :style="{
              transform: `translate(${ballPosition.x}px, ${-ballPosition.lift * 0.55}em) scaleX(${1 / style.aspectRatio})`,
            }"
          />
        </span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.lyrics {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.scroller {
  --line-height: calc(var(--font-size) * 1.5);
  position: absolute;
  inset-inline: 4%;
  top: var(--anchor);
  font-family: var(--font-family);
  font-size: var(--font-size);
  font-weight: bold;
  line-height: var(--line-height);
  text-align: var(--align);
  transform: translateY(calc(var(--focus) * var(--line-height) * -1 * var(--dir)));
  transition: transform 0.4s ease-out;
}

/* Lines scroll up as they are sung; top-to-bottom lyrics mirror that, so upcoming lines sit above. */
.lyrics {
  --dir: 1;
  /* Room around each line's clipped layers for outlines and selected-text effects (a jump or zoom on the sung syllable). */
  --bleed: 1.5em;
}

.motion-down {
  --dir: -1;
}

/* Still lyrics show a page at a time without moving: the page changes in place. */
.motion-still .scroller {
  transition: none;
}

/* `IsFade=0`: lines appear and disappear at once. */
.no-fade .line {
  transition: none;
}

/* Lines sit at fixed slots, so rendering only a window of them keeps the layout stable. */
.line {
  position: absolute;
  inset-inline: 0;
  top: calc(var(--index) * var(--line-height) * var(--dir));
  margin: 0;
  height: var(--line-height);
  /* Shrink lines that would be wider than the stage allows. */
  font-size: min(var(--font-size), var(--fit));
  white-space: nowrap;
  transition: opacity 0.4s;
}

.line.past {
  opacity: 0.35;
}

.line.hidden {
  opacity: 0;
}

/* Sits just above the glyphs; `transform` moves it every frame (x in px, lift in em). */
.ball {
  position: absolute;
  top: 0.05em;
  left: -0.14em;
  width: 0.28em;
  height: 0.28em;
  border-radius: 50%;
  background: var(--active);
  box-shadow:
    0 0 0 0.04em var(--frame, #000),
    0 0.05em 0.12em rgb(0 0 0 / 0.5);
  pointer-events: none;
}

/* Wider (or narrower) glyphs, from the side the line is aligned to. */
.stretch {
  display: block;
  position: relative;
  transform: scaleX(var(--aspect, 1));
  transform-origin: var(--align) center;
}

/* Both layers hold the same text, so their glyphs line up exactly. */
.layer {
  display: block;
}

.fill {
  position: absolute;
  inset: 0;
}

/*
 * The unsung layer shows right of the wipe and the sung layer left of it.
 * Each is faded as a whole, so translucent colors show the background.
 */
.base {
  position: relative;
  --text: var(--unsung-text);
  --stroke: var(--unsung-frame);
  opacity: var(--unsung-opacity);
  clip-path: inset(calc(-1 * var(--bleed)) calc(-1 * var(--bleed)) calc(-1 * var(--bleed)) var(--sung-until));
}

.fill {
  --text: var(--sung-text);
  --stroke: var(--sung-frame);
  opacity: var(--sung-opacity);
  clip-path: inset(
    calc(-1 * var(--bleed)) calc(100% - var(--sung-until)) calc(-1 * var(--bleed)) calc(-1 * var(--bleed))
  );
}

.copy {
  display: block;
  position: relative;
}

/* The outline is a stroked copy under the whole line, so one syllable's outline never paints over its neighbour. */
.stroke {
  position: absolute;
  inset: 0;
  /* Only the outline: filled glyphs would show through translucent text. */
  color: transparent;
  -webkit-text-stroke: calc(2 * var(--outline)) var(--stroke);
}

/* `FrameType=Shadow`: the copy sits down and right of the text instead of around it. */
.shadow .stroke {
  color: var(--stroke);
  -webkit-text-stroke: 0;
  transform: translate(calc(1.5 * var(--outline)), calc(1.5 * var(--outline)));
}

.text {
  color: var(--text);
}

/* Songs can animate their colors; fade as long as the latest change asks. */
.layer {
  transition: opacity var(--color-fade);
}

.stroke,
.text {
  transition:
    color var(--color-fade),
    -webkit-text-stroke-color var(--color-fade);
}

/* Selected-text effects on the syllable being sung (same on both layers so they stay aligned). */
.sel {
  --i: var(--sel-intensity, 1);
  transform-origin: 50% 80%;
}

.sel-LittleShake {
  animation: sel-shake 0.18s linear infinite alternate;
}

.sel-JumpOneTime {
  animation: sel-jump 0.35s ease-out;
}

.sel-PushOneTime {
  animation: sel-push 0.3s ease-out;
}

.sel-ZoomIn {
  animation: sel-zoom 0.25s ease-out forwards;
}

.sel-ZoomOutAndIn {
  animation: sel-zoom-out-in 0.4s ease-in-out;
}

.sel-MoveLeft {
  animation: sel-move 0.3s ease-out forwards;
  --dx: -0.15em;
  --dy: 0em;
}

.sel-MoveRight {
  animation: sel-move 0.3s ease-out forwards;
  --dx: 0.15em;
  --dy: 0em;
}

.sel-MoveBottom {
  animation: sel-move 0.3s ease-out forwards;
  --dx: 0em;
  --dy: 0.15em;
}

.sel-MoveBottomLeft {
  animation: sel-move 0.3s ease-out forwards;
  --dx: -0.12em;
  --dy: 0.12em;
}

.sel-Shoot {
  animation: sel-shoot 0.35s ease-out;
}

@keyframes sel-shake {
  from {
    transform: translate(calc(-0.02em * var(--i)), 0) rotate(calc(-2deg * var(--i)));
  }
  to {
    transform: translate(calc(0.02em * var(--i)), calc(-0.01em * var(--i))) rotate(calc(2deg * var(--i)));
  }
}

@keyframes sel-jump {
  50% {
    transform: translateY(calc(-0.25em * var(--i)));
  }
}

@keyframes sel-push {
  40% {
    transform: scale(calc(1 + 0.15 * var(--i)));
  }
}

@keyframes sel-zoom {
  to {
    transform: scale(calc(1 + 0.15 * var(--i)));
  }
}

@keyframes sel-zoom-out-in {
  30% {
    transform: scale(calc(1 - 0.12 * var(--i)));
  }
  70% {
    transform: scale(calc(1 + 0.12 * var(--i)));
  }
}

@keyframes sel-move {
  to {
    transform: translate(calc(var(--dx) * var(--i)), calc(var(--dy) * var(--i)));
  }
}

@keyframes sel-shoot {
  60% {
    transform: scale(calc(1 + 0.35 * var(--i)));
    opacity: 0.6;
  }
}

.syl {
  display: inline-block;
  white-space: pre;
}
</style>
