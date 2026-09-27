<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect } from 'vue'
import { useKeyframe, type Clock } from '../composables/useKeyframe'
import { useObjectUrl } from '../composables/useObjectUrl'
import { canvasTranslate, cssTransition, latestFrame } from '../kfn/effects'
import type { KfnEntry } from '../kfn/parseKfn'
import { entryBlob, sniffMime, type Backdrop, type VideoBackground } from '../kfn/song'

/**
 * The song's background: timed pictures (with crossfades, tint, position and
 * zoom) and optionally a video that follows the audio clock.
 */
const props = withDefaults(
  defineProps<{
    backdrop: Backdrop
    video?: VideoBackground | null
    /** Current song position (ms). */
    clock: Clock
    playing?: boolean
    playbackRate?: number
  }>(),
  { video: null, playing: false, playbackRate: 1 },
)

/** Re-seek the video when it drifts further than this from the audio. */
const MAX_VIDEO_DRIFT_S = 0.3

// --- pictures ---------------------------------------------------------------

const imageUrls = shallowRef(new Map<KfnEntry, string>())
watchEffect((onCleanup) => {
  const urls = new Map<KfnEntry, string>()
  for (const frame of props.backdrop.image) {
    if (frame.value && !urls.has(frame.value))
      urls.set(frame.value, URL.createObjectURL(entryBlob(frame.value)))
  }
  imageUrls.value = urls
  onCleanup(() => urls.forEach((url) => URL.revokeObjectURL(url)))
})

// Each track's keyframe now; the styles below only change at keyframes (see useKeyframe).
const imageFrame = useKeyframe(() => props.backdrop.image, props.clock)
const color = useKeyframe(() => props.backdrop.color, props.clock)
const tint = useKeyframe(() => props.backdrop.imageColor, props.clock)
const offsetX = useKeyframe(() => props.backdrop.offsetX, props.clock)
const offsetY = useKeyframe(() => props.backdrop.offsetY, props.clock)
const depth = useKeyframe(() => props.backdrop.depth, props.clock)

/**
 * One layer per picture, but only the previous, current and next pictures get
 * their image set: enough for crossfades (and preloading the next one) without
 * keeping every picture of the song decoded.
 */
const layers = computed(() => {
  const frames = props.backdrop.image
  const i = imageFrame.value ? frames.indexOf(imageFrame.value) : -1
  const near = new Set([frames[i - 1]?.value, frames[i]?.value, frames[i + 1]?.value])
  return [...imageUrls.value].map(([entry, url]) => ({
    url,
    image: near.has(entry) ? `url(${url})` : undefined,
    visible: entry === imageFrame.value?.value,
  }))
})

const pictureStyle = computed(() => {
  const scale = Math.max(0.2, 1 - 0.08 * (depth.value?.value ?? 0))
  // Offset and depth share one transform; animate it the way the most recent change asks.
  const move = latestFrame<number>(offsetX.value, offsetY.value, depth.value)
  return {
    transform: `${canvasTranslate(offsetX.value?.value, offsetY.value?.value)} scale(${scale})`,
    transition: `${cssTransition(move, 'transform')}, ${cssTransition(tint.value, 'opacity')}`,
    opacity: tint.value?.value.opacity ?? 1,
  }
})

// --- video ------------------------------------------------------------------

const videoEl = ref<HTMLVideoElement>()
const videoEnded = ref(false)
const videoFailed = ref(false)
watch(
  () => props.video,
  () => {
    videoEnded.value = false
    videoFailed.value = false
  },
)

/** The video's blob, unless this browser can't play it (then the pictures show instead). */
const videoUrl = useObjectUrl(() => {
  const v = props.video
  if (!v || videoFailed.value) return null
  const type = sniffMime(v.entry)
  if (!document.createElement('video').canPlayType(type)) {
    console.warn(`Video background ${v.entry.name} (${type}) can't be played in this browser`)
    return null
  }
  return entryBlob(v.entry)
})

function onVideoError(): void {
  console.warn(`Video background ${props.video?.entry.name} failed to play`)
  videoFailed.value = true
}

/** Keep the video on the audio clock: follow seeks and correct drift. */
function syncVideo(): void {
  const el = videoEl.value
  const v = props.video
  if (!el || !v || !Number.isFinite(el.duration)) return
  let target = (v.seekMs + props.clock()) / 1000
  if (v.loop) target %= el.duration
  videoEnded.value = !v.loop && target >= el.duration
  // `seeking` means a correction is already under way; don't pile up seeks.
  if (!videoEnded.value && !el.seeking && Math.abs(el.currentTime - target) > MAX_VIDEO_DRIFT_S) {
    el.currentTime = target
  }
}

watch(props.clock, syncVideo)
// Play whenever the song plays and the video hasn't run out (also after seeking back into it).
watch([() => props.playing, videoEnded, videoEl], ([playing, ended, el]) => {
  if (!el) return
  if (playing && !ended) el.play().catch(() => {})
  else el.pause()
})
watch(
  [() => props.playbackRate, videoEl],
  ([rate, el]) => {
    if (el) el.playbackRate = rate
  },
  { immediate: true },
)

const showVideo = computed(() => !videoEnded.value || !!props.video?.displayLastFrame)
</script>

<template>
  <div
    class="background"
    :style="{ backgroundColor: color?.value, transition: cssTransition(color, 'background-color') }"
  >
    <div class="pictures" :style="pictureStyle">
      <div
        v-for="layer in layers"
        :key="layer.url"
        class="picture"
        :style="{
          backgroundImage: layer.image,
          opacity: layer.visible ? 1 : 0,
          transition: cssTransition(imageFrame, 'opacity'),
        }"
      />
      <div
        v-if="tint?.value.tint"
        class="tint"
        :style="{ backgroundColor: tint.value.tint, transition: cssTransition(tint, 'background-color') }"
      />
    </div>
    <video
      v-if="videoUrl"
      v-show="showVideo"
      ref="videoEl"
      class="video"
      :src="videoUrl"
      :loop="video?.loop"
      muted
      playsinline
      preload="auto"
      @loadedmetadata="syncVideo"
      @error="onVideoError"
    />
  </div>
</template>

<style scoped>
.background {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.pictures,
.picture,
.tint,
.video {
  position: absolute;
  inset: 0;
}

.picture {
  background-position: center;
  background-size: cover;
}

.tint {
  mix-blend-mode: multiply;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
</style>
