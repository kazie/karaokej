<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LyricsView from '../components/LyricsView.vue'
import { still } from '../kfn/effects'
import type { LyricsStyle } from '../kfn/parseSongIni'
import { parseKfn } from '../kfn/parseKfn'
import { loadSong, type LyricsTrack } from '../kfn/song'
import { makeDemoKfn } from './demoSong'

/**
 * The demo song's lyrics with their own clock, for stories. The clock lives
 * here rather than in story state, because Histoire syncs story state between
 * frames and would do so on every animation frame.
 */
const props = withDefaults(
  defineProps<{
    playing?: boolean
    /** Jump to this position (ms) whenever it changes. */
    seekMs?: number
    style?: Partial<LyricsStyle>
    fontScale?: number
    compact?: boolean
    ball?: boolean
  }>(),
  { playing: true, seekMs: 0, style: () => ({}), fontScale: 0.3, compact: false, ball: true },
)

const base = loadSong(parseKfn(makeDemoKfn())).lyrics[0]!
const lastLine = base.timeline.lines.findLast((l) => l.syllables.length)
const duration = Math.ceil((lastLine?.end ?? 0) + 2000)

const COLOR_KEYS = ['activeColor', 'inactiveColor', 'frameColor', 'inactiveFrameColor'] as const

/** The demo track with the story's style overrides; an overridden color replaces its animated track. */
const track = computed<LyricsTrack>(() => {
  const effects = { ...base.effects }
  for (const key of COLOR_KEYS) {
    const color = props.style[key]
    if (color) effects[key] = still(color)
  }
  return { ...base, style: { ...base.style, ...props.style }, effects }
})
const time = ref(props.seekMs)
const clock = () => time.value

let frame = 0
let lastTick = 0
function tick(now: number): void {
  time.value = (time.value + (now - lastTick)) % duration
  lastTick = now
  frame = requestAnimationFrame(tick)
}

watch(
  () => props.playing,
  (playing) => {
    cancelAnimationFrame(frame)
    if (playing) {
      lastTick = performance.now()
      frame = requestAnimationFrame(tick)
    }
  },
  { immediate: true },
)
watch(
  () => props.seekMs,
  (ms) => (time.value = ms),
)
onBeforeUnmount(() => cancelAnimationFrame(frame))

defineExpose({ duration })
</script>

<template>
  <LyricsView :track="track" :clock="clock" :font-scale="fontScale" :compact="compact" :ball="ball" />
</template>
