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

/**
 * Whether bands come and go. Their lyrics are then always compact, so a
 * singer's layout doesn't jump when another singer's band appears.
 */
const dynamic = computed(() => props.tracks.length > MAX_FIXED_TRACKS)
const windows = computed(() => props.tracks.map((t) => trackWindows(t.timeline, props.leadInMs)))

/** The tracks with a band. The same array while the set is unchanged, so bands don't re-render every frame. */
const shown = computed<number[]>((previous) => {
  const next = dynamic.value
    ? activeTracks(windows.value, props.clock(), props.leadInMs <= 0)
    : props.tracks.map((_, i) => i)
  return previous && previous.join() === next.join() ? previous : next
})
const bands = computed(() => shown.value.map((index) => ({ index, track: props.tracks[index]! })))

const showCaptions = computed(() => props.tracks.length > 1)
</script>

<template>
  <TransitionGroup name="band">
    <div
      v-for="({ index, track }, slot) in bands"
      :key="index"
      class="band"
      :style="{ top: `${(slot / bands.length) * 100}%`, height: `${100 / bands.length}%` }"
    >
      <LyricsView
        :track="track"
        :clock="clock"
        :font-scale="fontScale"
        :compact="compact || dynamic || bands.length > 1"
        :ball="ball"
        :lead-in-ms="leadInMs"
        :highlight="highlight"
        :outline="outline"
      />
      <span
        v-if="showCaptions && track.caption"
        class="caption"
        :style="{ color: track.style.activeColor, '--frame': track.style.frameColor }"
        >{{ track.caption }}</span
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
