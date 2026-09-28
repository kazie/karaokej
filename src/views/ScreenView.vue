<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import IdleScreen from '../components/IdleScreen.vue'
import KaraokePlayer from '../components/KaraokePlayer.vue'
import { remoteUrl } from '../api'
import { useFullscreen } from '../composables/useFullscreen'
import { useWakeLock } from '../composables/useWakeLock'
import { parseKfn } from '../kfn/parseKfn'
import { loadSong, type KaraokeSong } from '../kfn/song'
import { useServices } from '../services'
import { errorMessage } from '../shared/errors'
import type { ServerInfo } from '../shared/protocol'

const TITLE_CARD_MS = 6000
const UP_NEXT_BEFORE_END_MS = 20_000
const TOOLBAR_HIDE_MS = 3000

const { connect, getInfo, fetchSongFile } = useServices()
const { state, connected, report } = connect('screen')
const fullscreen = useFullscreen()
const wakeLock = useWakeLock()

const info = shallowRef<ServerInfo | null>(null)
const url = computed(() => remoteUrl(info.value, window.location))

/** Browsers only allow audio after a user gesture on the page. */
const started = ref(false)
/** The parsed song and the queue item it belongs to. */
const loaded = shallowRef<{ itemId: string; song: KaraokeSong } | null>(null)
const showTitleCard = ref(false)
const toolbarVisible = ref(true)
const player = ref<InstanceType<typeof KaraokePlayer>>()

const current = computed(() => state.value?.current ?? null)
const upNext = computed(() => state.value?.queue[0] ?? null)
// Position comes back from the server about once a second; plenty for a 20 s threshold.
const showUpNext = computed(() => {
  const s = state.value
  return !!upNext.value && !!s?.durationMs && s.durationMs - s.positionMs < UP_NEXT_BEFORE_END_MS
})
/** The loaded song, if it is the one the session wants played. */
const playing = computed(() =>
  loaded.value && loaded.value.itemId === current.value?.id ? loaded.value : null,
)
const loadingTitle = computed(() =>
  started.value && current.value && !playing.value ? current.value.song.title : null,
)

async function refreshInfo(): Promise<void> {
  info.value = await getInfo().catch(() => info.value)
}

onMounted(refreshInfo)
watch(connected, (isConnected) => isConnected && refreshInfo())

let loadController: AbortController | undefined
let titleTimer: ReturnType<typeof setTimeout> | undefined

watch(
  [() => current.value?.id, started] as const,
  async ([itemId, isStarted]) => {
    if (!itemId) {
      loadController?.abort()
      loaded.value = null
      return
    }
    if (!isStarted || loaded.value?.itemId === itemId) return
    const item = current.value!
    loadController?.abort()
    const controller = (loadController = new AbortController())
    loaded.value = null
    try {
      const bytes = await fetchSongFile(item.song.id, controller.signal)
      if (controller.signal.aborted) return
      const song = loadSong(parseKfn(bytes))
      for (const warning of song.warnings) console.warn(`${item.song.title}: ${warning}`)
      loaded.value = { itemId, song }
      showTitleCard.value = true
      clearTimeout(titleTimer)
      titleTimer = setTimeout(() => (showTitleCard.value = false), TITLE_CARD_MS)
    } catch (e) {
      if (controller.signal.aborted) return
      report({ type: 'failed', itemId, message: errorMessage(e) })
    }
  },
  { immediate: true },
)

// Player events always concern the song being played. Reports survive network drops:
// they are re-sent after reconnecting until the server's state confirms them.
function onReady(durationMs: number): void {
  if (playing.value) report({ type: 'loaded', itemId: playing.value.itemId, durationMs })
}

function onProgress(positionMs: number, skippable: boolean): void {
  if (playing.value) report({ type: 'progress', itemId: playing.value.itemId, positionMs, skippable })
}

function onEnded(): void {
  if (playing.value) report({ type: 'ended', itemId: playing.value.itemId })
}

function onError(message: string): void {
  if (playing.value) report({ type: 'failed', itemId: playing.value.itemId, message })
}

function start(withFullscreen: boolean): void {
  started.value = true
  wakeLock.acquire()
  if (withFullscreen) fullscreen.enter()
  player.value?.play()
}

// Toolbar: visible on pointer movement, hidden after a moment of inactivity.
let hideTimer: ReturnType<typeof setTimeout> | undefined
function poke(): void {
  toolbarVisible.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => (toolbarVisible.value = false), TOOLBAR_HIDE_MS)
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'f' || event.key === 'F') fullscreen.toggle()
}

onMounted(() => {
  poke()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  loadController?.abort()
  clearTimeout(hideTimer)
  clearTimeout(titleTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="screen"
    :class="{ 'hide-cursor': !toolbarVisible }"
    @pointermove="poke"
    @dblclick="fullscreen.toggle()"
  >
    <KaraokePlayer
      v-if="playing && state"
      ref="player"
      :song="playing.song"
      :paused="state.status === 'paused' || !started"
      :request="state.request"
      :playback-rate="state.playbackRate"
      :auto-skip="state.settings.autoSkipInterludes"
      :ball="current?.ball !== false"
      :lead-in-ms="state.settings.leadInMs"
      :highlight="state.settings.highlight"
      @ready="onReady"
      @progress="onProgress"
      @ended="onEnded"
      @error="onError"
      @blocked="started = false"
    />
    <IdleScreen v-else :url="url" :queue="state?.queue ?? []" :scan="state?.scan" :loading="loadingTitle" />

    <Transition name="fade">
      <div v-if="playing && showTitleCard && current" class="title-card">
        <h1>{{ current.song.title }}</h1>
        <p>{{ current.song.artist }}</p>
        <p v-if="current.singer" class="singer">🎤 {{ current.singer }}</p>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="playing && showUpNext && upNext" class="up-next">
        <span class="label">Up next</span>
        <strong>{{ upNext.song.title }}</strong>
        <span v-if="upNext.singer"> · 🎤 {{ upNext.singer }}</span>
      </div>
    </Transition>

    <div v-if="playing && state?.status === 'paused'" class="paused">Paused</div>

    <div v-if="!started" class="start" :class="{ blocking: !!current }">
      <p v-if="current">“{{ current.song.title }}” is ready. Tap to start the karaoke screen.</p>
      <p v-else>Start the screen to enable sound.</p>
      <div class="start-buttons">
        <button type="button" class="btn-primary" @click.stop="start(fullscreen.supported)">
          {{ fullscreen.supported ? 'Start in fullscreen' : 'Start' }}
        </button>
        <button v-if="fullscreen.supported" type="button" class="btn-secondary" @click.stop="start(false)">
          Start windowed
        </button>
      </div>
    </div>

    <div class="toolbar" :class="{ visible: toolbarVisible || !connected }">
      <span class="conn" :class="{ on: connected }">{{ connected ? 'Connected' : 'Reconnecting…' }}</span>
      <button
        v-if="fullscreen.supported"
        type="button"
        :aria-label="fullscreen.active.value ? 'Exit fullscreen' : 'Enter fullscreen'"
        @click.stop="fullscreen.toggle()"
      >
        {{ fullscreen.active.value ? '⤡ Exit fullscreen' : '⤢ Fullscreen' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.screen {
  --fade-duration: 0.5s;
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
  user-select: none;
}

.hide-cursor {
  cursor: none;
}

.title-card {
  position: absolute;
  left: 50%;
  top: 12%;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 1em 1.5em;
  border-radius: var(--radius);
  background: rgb(0 0 0 / 0.6);
  text-align: center;
  font-size: clamp(0.8rem, 2.5vmin, 1.8rem);
}

.title-card h1 {
  margin: 0;
  font-size: 2em;
}

.title-card p {
  margin: 0.3em 0 0;
  color: var(--muted);
}

.title-card .singer {
  color: var(--accent);
}

.up-next {
  position: absolute;
  right: 2vmin;
  bottom: 2vmin;
  max-width: 60%;
  padding: 0.6em 1em;
  border-radius: var(--radius);
  background: rgb(0 0 0 / 0.65);
  font-size: clamp(0.8rem, 2.2vmin, 1.5rem);
}

.up-next .label {
  display: block;
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.paused {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.45);
  font-size: clamp(1.5rem, 8vmin, 6rem);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.start {
  position: absolute;
  left: 50%;
  bottom: 4vmin;
  transform: translateX(-50%);
  width: min(36rem, calc(100% - 2rem));
  padding: 1rem 1.25rem;
  border-radius: var(--radius);
  background: rgb(28 31 43 / 0.92);
  text-align: center;
  box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 0.4);
}

.start.blocking {
  top: 50%;
  bottom: auto;
  transform: translate(-50%, -50%);
}

.start p {
  margin: 0 0 0.75rem;
}

.start-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

.toolbar {
  position: absolute;
  top: calc(0.75rem + env(safe-area-inset-top, 0px));
  right: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.toolbar.visible {
  opacity: 1;
  pointer-events: auto;
}

.toolbar button,
.conn {
  padding: 0.4rem 0.7rem;
  border: none;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  font-size: 0.85rem;
}

.toolbar button {
  cursor: pointer;
}

.conn::before {
  content: '';
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  margin-right: 0.4em;
  border-radius: 50%;
  background: var(--danger);
}

.conn.on::before {
  background: var(--accent);
}
</style>
