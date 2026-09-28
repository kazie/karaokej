<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LyricsView from '../components/LyricsView.vue'
import { still } from '../kfn/effects'
import type { LyricsStyle } from '../kfn/parseSongIni'
import { parseKfn } from '../kfn/parseKfn'
import { loadSong, type LyricsTrack } from '../kfn/song'
import type { HighlightMode } from '../shared/protocol'
import { makeDemoKfn, makeDuetDemoKfn } from './demoSong'

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
    leadInMs?: number
    highlight?: HighlightMode
    /** The duet demo instead: one band per singer, as on the player. */
    duet?: boolean
  }>(),
  {
    playing: true,
    seekMs: 0,
    style: () => ({}),
    fontScale: 0.3,
    compact: false,
    ball: true,
    leadInMs: 0,
    highlight: 'wipe',
    duet: false,
  },
)

const soloTracks = loadSong(parseKfn(makeDemoKfn())).lyrics
const duetTracks = loadSong(parseKfn(makeDuetDemoKfn())).lyrics
const bases = computed(() => (props.duet ? duetTracks : soloTracks))
const duration = computed(() => {
  const ends = bases.value.flatMap((t) =>
    t.timeline.lines.filter((l) => l.syllables.length).map((l) => l.end),
  )
  return Math.ceil(Math.max(0, ...ends) + 2000)
})

const COLOR_KEYS = ['activeColor', 'inactiveColor', 'frameColor', 'inactiveFrameColor'] as const

/** The demo tracks with the story's style overrides; an overridden color replaces its animated track. */
const tracks = computed<LyricsTrack[]>(() =>
  bases.value.map((base) => {
    const effects = { ...base.effects }
    for (const key of COLOR_KEYS) {
      const color = props.style[key]
      if (color) effects[key] = still(color)
    }
    return { ...base, style: { ...base.style, ...props.style }, effects }
  }),
)
const time = ref(props.seekMs)
const clock = () => time.value

let frame = 0
let lastTick = 0
function tick(now: number): void {
  time.value = (time.value + (now - lastTick)) % duration.value
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
  <div
    v-for="(track, i) in tracks"
    :key="i"
    class="band"
    :style="{ top: `${(i / tracks.length) * 100}%`, height: `${100 / tracks.length}%` }"
  >
    <LyricsView
      :track="track"
      :clock="clock"
      :font-scale="fontScale"
      :compact="compact || tracks.length > 1"
      :ball="ball"
      :lead-in-ms="leadInMs"
      :highlight="highlight"
    />
  </div>
</template>

<style scoped>
/* One band per track, like the player's stage. */
.band {
  position: absolute;
  inset-inline: 0;
}
</style>
