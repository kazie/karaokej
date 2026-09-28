<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useKeyframe, type Clock } from '../composables/useKeyframe'
import { canvasTranslate, cssTransition, latestFrame, NO_SEL_TEXT_EFFECT } from '../kfn/effects'
import { ballAt, fillFraction, wipeFront } from '../kfn/wipe'
import type { LyricsTrack } from '../kfn/song'
import { focusLineIndex, lineWindows, shownAt, syllableProgress, type TimedLine } from '../kfn/timeline'
import type { HighlightMode } from '../shared/protocol'

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
  }>(),
  { fontScale: 0.3, compact: false, ball: false, leadInMs: 0, highlight: 'wipe' },
)

const LAYOUT = {
  normal: { before: 2, after: 3, anchor: 45 },
  compact: { before: 1, after: 1, anchor: 30 },
}
/** Share of the stage width a line may take before it is shrunk. */
const MAX_LINE_WIDTH_CQW = 92

const layout = computed(() => (props.compact ? LAYOUT.compact : LAYOUT.normal))
const lines = computed(() => props.track.timeline.lines)
const style = computed(() => props.track.style)

let canvas: CanvasRenderingContext2D | null | undefined

/** Each line's width in em, measured once per track in the song's own font. */
const lineWidthsEm = computed(() => {
  canvas ??= document.createElement('canvas').getContext('2d')
  const family = style.value.fontFamily
  return lines.value.map((line) => {
    const text = line.syllables.map((s) => s.text).join('')
    if (!canvas) return text.length * 0.6
    canvas.font = `bold 100px '${family}', Arial, sans-serif`
    return canvas.measureText(text).width / 100
  })
})

const focusIndex = computed(() => focusLineIndex(props.track.timeline, props.clock()))
const focusLine = computed(() => lines.value[focusIndex.value])

/** When each line is on screen, so lyrics don't sit there through long pauses. */
const windows = computed(() => lineWindows(props.track.timeline, props.leadInMs))
const shown = (line: TimedLine) => shownAt(windows.value[line.index]!, props.clock())

/**
 * Only lines near the focus are rendered. One extra, invisible line on each
 * side lets lines fade in and out as the window moves.
 */
const windowLines = computed(() => {
  const { before, after } = layout.value
  const from = Math.max(0, focusIndex.value - before - 1)
  return lines.value.slice(from, focusIndex.value + after + 2)
})

function outline(color: string): string {
  const o = '0.045em'
  return [`${o} 0`, `-${o} 0`, `0 ${o}`, `0 -${o}`]
    .map((offset) => `drop-shadow(${offset} 0 ${color})`)
    .join(' ')
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
  return {
    '--font-family': `'${style.value.fontFamily}', Arial, sans-serif`,
    '--font-size': `min(${style.value.fontSize * props.fontScale}cqh, ${style.value.fontSize * props.fontScale * 1.1}cqw)`,
    '--active': activeColor.value?.value,
    '--inactive': inactiveColor.value?.value,
    '--frame': frameColor.value?.value,
    '--active-outline': outline(frameColor.value?.value ?? '#000'),
    '--inactive-outline': outline(inactiveFrameColor.value?.value ?? '#000'),
    '--color-fade': `${latestFrame(...colors)?.transitionMs ?? 0}ms`,
    '--sel-intensity': selEffect.value.intensity,
    '--align': style.value.alignment,
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
  const layer = line ? (root.value?.querySelector(`.line[data-index="${line.index}"] .base`) ?? null) : null
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
  if (selEffect.value === NO_SEL_TEXT_EFFECT || lineState(line) !== 'current') return undefined
  const p = syllableProgress(line.syllables[si]!, props.clock())
  return p > 0 && p < 1 ? `sel sel-${selEffect.value.name}` : undefined
}

function visible(line: TimedLine): boolean {
  const offset = line.index - focusIndex.value
  return offset >= -layout.value.before && offset <= layout.value.after && shown(line)
}

function lineState(line: TimedLine): 'past' | 'current' | 'future' {
  const t = props.clock()
  if (line.end <= t) return 'past'
  if (line.start <= t) return 'current'
  return 'future'
}

function progress(line: TimedLine, si: number): number {
  if (props.highlight === 'instant') return props.clock() >= line.syllables[si]!.start ? 1 : 0
  if (line.index === focusIndex.value && front.value !== null && edges.value)
    return fillFraction(edges.value, front.value, si)
  return lineState(line) === 'past' ? 1 : 0
}
</script>

<template>
  <div ref="root" class="lyrics" :style="rootStyle">
    <div class="scroller" :style="{ '--focus': focusIndex }">
      <p
        v-for="line in windowLines"
        :key="line.index"
        class="line"
        :data-index="line.index"
        :class="[lineState(line), { hidden: !visible(line) }]"
        :style="{
          '--index': line.index,
          '--fit': `${MAX_LINE_WIDTH_CQW / Math.max(lineWidthsEm[line.index] ?? 1, 0.01)}cqw`,
        }"
      >
        <span class="layer base">
          <span v-for="(syl, si) in line.syllables" :key="si" class="syl" :class="selClass(line, si)">{{
            syl.text
          }}</span>
        </span>
        <span class="layer fill" aria-hidden="true">
          <span
            v-for="(syl, si) in line.syllables"
            :key="si"
            class="syl"
            :class="selClass(line, si)"
            :style="{ '--p': progress(line, si) }"
            >{{ syl.text }}</span
          >
        </span>
        <span
          v-if="line.index === focusIndex && ballPosition"
          class="ball"
          :style="{ transform: `translate(${ballPosition.x}px, ${-ballPosition.lift * 0.55}em)` }"
        />
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
  transform: translateY(calc(var(--focus) * var(--line-height) * -1));
  transition: transform 0.4s ease-out;
}

/* Lines sit at fixed slots, so rendering only a window of them keeps the layout stable. */
.line {
  position: absolute;
  inset-inline: 0;
  top: calc(var(--index) * var(--line-height));
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

/* Both layers hold the same text, so their glyphs line up exactly. */
.layer {
  display: block;
}

.fill {
  position: absolute;
  inset: 0;
}

/* The outline is a filter on the whole layer, so one syllable's outline never paints over its neighbour. */
.base {
  color: var(--inactive);
  filter: var(--inactive-outline);
}

.fill {
  color: var(--active);
  filter: var(--active-outline);
}

/* Songs can animate their colors; fade as long as the latest change asks. */
.base,
.fill {
  transition:
    color var(--color-fade),
    filter var(--color-fade);
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

.fill .syl {
  clip-path: inset(-0.3em calc((1 - var(--p)) * 100%) -0.3em -0.3em);
}
</style>
