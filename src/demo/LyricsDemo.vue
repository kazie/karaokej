<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LyricsStage from '../components/LyricsStage.vue'
import { still } from '../kfn/effects'
import type { LyricsStyle } from '../kfn/parseSongIni'
import { parseKfn } from '../kfn/parseKfn'
import { loadSong, type LyricsTrack } from '../kfn/song'
import type { HighlightMode, OutlineWidth } from '../shared/protocol'
import { makeDemoKfn, makeDuetDemoKfn, makeGroupDemoKfn } from './demoSong'

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
    outline?: OutlineWidth
    /** Which demo song: the duet and group demos have a band per singer, as on the player. */
    demo?: 'solo' | 'duet' | 'group'
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
    outline: 'normal',
    demo: 'solo',
  },
)

const DEMO_TRACKS = {
  solo: loadSong(parseKfn(makeDemoKfn())).lyrics,
  duet: loadSong(parseKfn(makeDuetDemoKfn())).lyrics,
  group: loadSong(parseKfn(makeGroupDemoKfn())).lyrics,
}
const bases = computed(() => DEMO_TRACKS[props.demo])
const duration = computed(() => {
  const ends = bases.value.flatMap((t) =>
    t.timeline.lines.filter((l) => l.syllables.length).map((l) => l.end),
  )
  return Math.ceil(Math.max(0, ...ends) + 2000)
})

const COLOR_KEYS = ['activeColor', 'inactiveColor', 'frameColor', 'inactiveFrameColor'] as const

/** The demo tracks with the story's style overrides; an overridden color or trajectory replaces its animated track. */
const tracks = computed<LyricsTrack[]>(() =>
  bases.value.map((base) => {
    const effects = { ...base.effects }
    for (const key of COLOR_KEYS) {
      const color = props.style[key]
      if (color) effects[key] = still(color)
    }
    if (props.style.trajectory) effects.trajectory = still(props.style.trajectory)
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
  <LyricsStage
    :tracks="tracks"
    :clock="clock"
    :font-scale="fontScale"
    :compact="compact"
    :ball="ball"
    :lead-in-ms="leadInMs"
    :highlight="highlight"
    :outline="outline"
  />
</template>
