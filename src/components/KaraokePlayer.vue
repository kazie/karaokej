<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BackgroundLayer from './BackgroundLayer.vue'
import InterludeOverlay from './InterludeOverlay.vue'
import LyricsView from './LyricsView.vue'
import { entryBlob, type KaraokeSong } from '../kfn/song'
import { useKeyframe, type Clock } from '../composables/useKeyframe'
import { useObjectUrl } from '../composables/useObjectUrl'
import { buildGaps, countdownStart, gapAt, type Gap } from '../kfn/timeline'
import type { PlaybackRequest } from '../shared/protocol'
import { errorMessage, isAbortError } from '../shared/errors'

const props = withDefaults(
  defineProps<{
    song: KaraokeSong
    /** Controlled playback: the player follows this flag. */
    paused?: boolean
    /** Playback request from the session (restart, seek, skip); each `seq` is applied once. */
    request?: PlaybackRequest | null
    playbackRate?: number
    /** Skip long intros and interludes to the countdown automatically. */
    autoSkip?: boolean
    /** Show the bouncing ball over the lyrics. */
    ball?: boolean
    /** Show the native audio controls (for stories and local testing). */
    controls?: boolean
  }>(),
  { paused: false, request: null, playbackRate: 1, autoSkip: false, ball: true, controls: false },
)

const emit = defineEmits<{
  /** Audio has actually started playing (once per song); 0 when the length is unknown. */
  ready: [durationMs: number]
  /** `skippable`: in a gap that "Skip to next verse" can jump over. */
  progress: [positionMs: number, skippable: boolean]
  ended: []
  error: [message: string]
  /** The browser refused to start audio without a user gesture. */
  blocked: []
}>()

const PROGRESS_INTERVAL_MS = 1000
/** A gap is worth skipping when more than this is left before the countdown. */
const MIN_SKIP_MS = 500
/** Auto-skip only gaps with at least this much left. */
const AUTO_SKIP_MIN_MS = 10_000
/** Arriving this close to a gap's start counts as playing into it (not seeking into it). */
const AUTO_SKIP_ENTRY_WINDOW_MS = 1000

const audio = ref<HTMLAudioElement>()
const time = ref(0)
/** Children read the time through this, so they don't re-render on every frame (see Clock). */
const clock: Clock = () => time.value
const musicUrl = useObjectUrl(() => (props.song.music ? entryBlob(props.song.music) : null))
/** Whether audio is actually playing (drives the video background). */
const audioPlaying = ref(false)

/** The song's intro and interludes, computed once per song. */
const gaps = computed(() => buildGaps(props.song.lyrics.map((l) => l.timeline)))
/** The gap we're in, if any; the same object while it lasts. */
const gap = computed(() => gapAt(gaps.value, time.value))
/** The lyrics' sung color right now (songs may animate it), for the countdown. */
const sungFrame = useKeyframe(() => props.song.lyrics[0]?.effects.activeColor ?? [], clock)
const sungColor = computed(() => sungFrame.value?.value ?? '#fff')

/** Whether `ready` was emitted for the current song. Declared before the song watcher, which runs immediately. */
let reportedReady = false

watch(
  () => props.song,
  (song) => {
    time.value = 0
    reportedReady = false
    if (!song.music) emit('error', 'This file has no music track')
  },
  { immediate: true },
)

let frame = 0
let lastProgress = 0

/** Time left before the countdown of the current gap (0 outside gaps). */
const msToCountdown = computed(() => (gap.value ? countdownStart(gap.value) - time.value : 0))

function sync(): void {
  if (!audio.value) return
  time.value = audio.value.currentTime * 1000
  const now = performance.now()
  if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
    lastProgress = now
    emit('progress', Math.round(time.value), msToCountdown.value > MIN_SKIP_MS)
  }
}

function seekTo(ms: number): void {
  const el = audio.value
  if (!el) return
  const max = Number.isFinite(el.duration) ? el.duration * 1000 - 1000 : Infinity
  el.currentTime = Math.max(0, Math.min(ms, max)) / 1000
  lastProgress = 0 // report the new position right away
  sync()
}

function skipGap(): void {
  if (gap.value && msToCountdown.value > MIN_SKIP_MS) seekTo(countdownStart(gap.value))
}

function tick(): void {
  sync()
  frame = requestAnimationFrame(tick)
}

function play(): void {
  audio.value?.play().catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'NotAllowedError') emit('blocked')
    else if (!isAbortError(e)) emit('error', errorMessage(e))
  })
}

function onLoaded(): void {
  if (!props.paused) play()
}

/** Report `ready` only once audio really plays, so a blocked autoplay never looks like playback. */
function onPlaying(): void {
  if (reportedReady) return
  reportedReady = true
  // Some files (e.g. streamed or badly muxed MP3s) report an infinite or unknown length.
  const seconds = audio.value?.duration ?? NaN
  emit('ready', Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0)
}

function onPlay(): void {
  audioPlaying.value = true
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(tick)
}

function onPause(): void {
  audioPlaying.value = false
  cancelAnimationFrame(frame)
  lastProgress = 0
  sync()
}

function onEnded(): void {
  onPause()
  emit('ended')
}

function onAudioError(): void {
  emit('error', 'The music could not be played')
}

watch(
  () => props.paused,
  (paused) => (paused ? audio.value?.pause() : play()),
)

// Requests from before this song started (e.g. after a screen reload) are never replayed.
let appliedSeq = props.request?.seq ?? 0
watch(
  () => props.request,
  (req) => {
    if (!req || req.seq <= appliedSeq) return
    appliedSeq = req.seq
    if (req.kind === 'restart') seekTo(0)
    else if (req.kind === 'seekBy') seekTo(time.value + req.deltaMs)
    else skipGap()
  },
)

watch(
  [() => props.playbackRate, audio],
  ([rate, el]) => {
    if (!el) return
    el.preservesPitch = true // change tempo, not key
    el.playbackRate = rate
  },
  { immediate: true },
)

function maybeAutoSkip(): void {
  if (props.autoSkip && audioPlaying.value && msToCountdown.value >= AUTO_SKIP_MIN_MS) skipGap()
}

/**
 * Whether playback arrived at the start of `g` by playing (into an interlude, or
 * a song starting in its intro). A seek or resume deep inside a gap is a
 * deliberate choice to be there, so auto-skip leaves it alone.
 */
const playedInto = (g: Gap) => time.value - g.startMs < AUTO_SKIP_ENTRY_WINDOW_MS

// Auto-skip long gaps when playing into them, when a song starts in its intro,
// and when auto-skip is switched on mid-gap.
watch(gap, (g) => g && playedInto(g) && maybeAutoSkip())
watch(audioPlaying, (playing) => playing && gap.value && playedInto(gap.value) && maybeAutoSkip())
watch(
  () => props.autoSkip,
  (on) => on && maybeAutoSkip(),
)

onBeforeUnmount(() => cancelAnimationFrame(frame))

defineExpose({ play })
</script>

<template>
  <div class="player">
    <div class="stage">
      <BackgroundLayer
        :backdrop="song.backdrop"
        :video="song.video"
        :clock="clock"
        :playing="audioPlaying"
        :playback-rate="playbackRate"
      />
      <!-- Several lyric tracks (duets, backing vocals) each get their own band. -->
      <div
        v-for="(track, i) in song.lyrics"
        :key="i"
        class="band"
        :style="{ top: `${(i / song.lyrics.length) * 100}%`, height: `${100 / song.lyrics.length}%` }"
      >
        <LyricsView :track="track" :clock="clock" :compact="song.lyrics.length > 1" :ball="ball" />
      </div>
      <InterludeOverlay :gap="gap" :clock="clock" :color="sungColor" />
    </div>
    <audio
      v-if="musicUrl"
      ref="audio"
      class="audio"
      :class="{ visible: controls }"
      :src="musicUrl"
      :controls="controls"
      preload="auto"
      @loadedmetadata="onLoaded"
      @play="onPlay"
      @playing="onPlaying"
      @pause="onPause"
      @ended="onEnded"
      @seeked="sync"
      @error="onAudioError"
    />
  </div>
</template>

<style scoped>
.player {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.stage {
  position: absolute;
  inset: 0;
  /* Lyrics size themselves relative to the whole stage (cqh/cqw). */
  container-type: size;
}

.band {
  position: absolute;
  left: 0;
  right: 0;
}

.audio {
  display: none;
}

.audio.visible {
  display: block;
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 1rem;
  width: calc(100% - 2rem);
}
</style>
