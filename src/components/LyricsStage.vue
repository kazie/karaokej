<script setup lang="ts">
import { computed } from 'vue'
import LyricsView from './LyricsView.vue'
import type { Clock } from '../composables/useKeyframe'
import type { LyricsTrack } from '../kfn/song'
import { activeTracks, trackWindows } from '../kfn/timeline'
import type { HighlightMode, OutlineWidth } from '../shared/protocol'

/**
 * A song's lyric tracks, one band each. Duets keep a band per singer for the
 * whole song; with more tracks (some songs have one per character, up to 25)
 * only the tracks with lines on screen get a band.
 */
const props = withDefaults(
  defineProps<{
    tracks: LyricsTrack[]
    clock: Clock
    fontScale?: number
    /** Compact lyrics even with a single track. */
    compact?: boolean
    ball?: boolean
    /** Show a verse this long (ms) before it is sung; 0 shows the lyrics all the time. */
    leadInMs?: number
    highlight?: HighlightMode
    outline?: OutlineWidth
  }>(),
  { fontScale: undefined, compact: false, ball: false, leadInMs: 0, highlight: 'wipe', outline: 'normal' },
)

/** Songs with more tracks than this only show the active ones. */
const MAX_FIXED_TRACKS = 2

const dynamic = computed(() => props.tracks.length > MAX_FIXED_TRACKS)
const windows = computed(() => props.tracks.map((t) => trackWindows(t.timeline, props.leadInMs)))

/** The active tracks as a key, so the bands below only change when the set does, not every frame. */
const activeKey = computed(() =>
  dynamic.value
    ? activeTracks(windows.value, props.clock(), props.leadInMs <= 0).join(',')
    : props.tracks.map((_, i) => i).join(','),
)
const shown = computed(() => (activeKey.value ? activeKey.value.split(',').map(Number) : []))

const showCaptions = computed(() => props.tracks.length > 1)
</script>

<template>
  <TransitionGroup name="band">
    <div
      v-for="(index, slot) in shown"
      :key="index"
      class="band"
      :style="{ top: `${(slot / shown.length) * 100}%`, height: `${100 / shown.length}%` }"
    >
      <LyricsView
        :track="tracks[index]!"
        :clock="clock"
        :font-scale="fontScale"
        :compact="compact || shown.length > 1"
        :ball="ball"
        :lead-in-ms="leadInMs"
        :highlight="highlight"
        :outline="outline"
      />
      <span
        v-if="showCaptions && tracks[index]!.caption"
        class="caption"
        :style="{ color: tracks[index]!.style.activeColor, '--frame': tracks[index]!.style.frameColor }"
        >{{ tracks[index]!.caption }}</span
      >
    </div>
  </TransitionGroup>
</template>

<style scoped>
.band {
  position: absolute;
  inset-inline: 0;
  transition:
    top 0.4s ease-out,
    height 0.4s ease-out,
    opacity 0.4s;
}

.band-enter-from,
.band-leave-to {
  opacity: 0;
}

/* A leaving band no longer takes a slot; it fades where it was. */
.band-leave-active {
  position: absolute;
}

/* Who sings this band, sized from the stage like the lyrics. */
.caption {
  position: absolute;
  top: 4%;
  left: 3%;
  font-family: Arial, sans-serif;
  font-size: min(4cqh, 3cqw);
  font-weight: bold;
  -webkit-text-stroke: 0.12em var(--frame);
  paint-order: stroke fill;
  pointer-events: none;
}
</style>
