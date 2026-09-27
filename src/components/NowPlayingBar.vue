<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { queuedDetails, speedLabel } from '../format'
import { SEEK_STEP_MS, SPEED_STEPS, type SessionState } from '../shared/protocol'
import { snapSpeed } from '../shared/session'

const props = defineProps<{ state: SessionState }>()
const emit = defineEmits<{
  pause: []
  resume: []
  restart: []
  skip: []
  seek: [deltaMs: number]
  speed: [rate: number]
  ball: [enabled: boolean]
  skipInterlude: []
}>()

/** Nothing to seek while the screen is still loading the song. */
const loading = computed(() => props.state.status === 'loading')

const speedIndex = computed(() => SPEED_STEPS.indexOf(snapSpeed(props.state.playbackRate)))
function stepSpeed(direction: -1 | 1): void {
  const next = SPEED_STEPS[speedIndex.value + direction]
  if (next !== undefined) emit('speed', next)
}

// The screen reports progress about once a second; interpolate in between.
const now = ref(Date.now())
const receivedAt = ref(Date.now())
// Separate sources: the state object is replaced on every broadcast (queue edits,
// scan progress), and only real position/status changes should reset the clock.
watch([() => props.state.positionMs, () => props.state.status], () => (receivedAt.value = Date.now()))
const timer = setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => clearInterval(timer))

const position = computed(() => {
  const { positionMs, durationMs, status } = props.state
  const elapsed = status === 'playing' ? (now.value - receivedAt.value) * props.state.playbackRate : 0
  return Math.min(durationMs || Infinity, positionMs + elapsed)
})
const progress = computed(() => (props.state.durationMs ? position.value / props.state.durationMs : 0))

function time(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <section v-if="state.current" class="bar" aria-label="Now playing">
    <button v-if="state.skippable" type="button" class="skip-verse" @click="emit('skipInterlude')">
      Skip to next verse ⏩
    </button>
    <div class="progress" :style="{ '--progress': progress }" />
    <div class="row">
      <div class="info">
        <span class="title">{{ state.current.song.title }}</span>
        <span class="meta">
          <template v-if="state.status === 'loading'">Loading…</template>
          <template v-else-if="state.durationMs"
            >{{ time(position) }} / {{ time(state.durationMs) }}</template
          >
          <template v-else>{{ time(position) }}</template>
          · {{ queuedDetails(state.current.song, state.current.singer) }}
        </span>
      </div>
      <div class="controls">
        <button type="button" aria-label="Restart" :disabled="loading" @click="emit('restart')">⏮</button>
        <button
          v-if="state.status === 'paused'"
          type="button"
          aria-label="Resume"
          class="main"
          @click="emit('resume')"
        >
          ▶
        </button>
        <button v-else type="button" aria-label="Pause" class="main" @click="emit('pause')">⏸</button>
        <button type="button" aria-label="Skip" @click="emit('skip')">⏭</button>
      </div>
    </div>
    <div class="row secondary">
      <button
        type="button"
        class="pill"
        aria-label="Back 10 seconds"
        :disabled="loading"
        @click="emit('seek', -SEEK_STEP_MS)"
      >
        −10 s
      </button>
      <button
        type="button"
        class="pill"
        aria-label="Forward 10 seconds"
        :disabled="loading"
        @click="emit('seek', SEEK_STEP_MS)"
      >
        +10 s
      </button>
      <span class="speed" role="group" aria-label="Playback speed">
        <button type="button" aria-label="Slower" :disabled="speedIndex === 0" @click="stepSpeed(-1)">
          −
        </button>
        <button type="button" class="speed-value" aria-label="Reset speed to 1×" @click="emit('speed', 1)">
          {{ speedLabel(state.playbackRate) }}
        </button>
        <button
          type="button"
          aria-label="Faster"
          :disabled="speedIndex === SPEED_STEPS.length - 1"
          @click="stepSpeed(1)"
        >
          +
        </button>
      </span>
      <button
        type="button"
        class="pill ball-toggle"
        :aria-pressed="state.current.ball"
        :title="state.current.ball ? 'Hide the bouncing ball' : 'Show the bouncing ball'"
        @click="emit('ball', !state.current.ball)"
      >
        ● Ball
      </button>
    </div>
  </section>
</template>

<style scoped>
.bar {
  position: relative;
  background: var(--surface);
  border-top: 1px solid var(--surface-2);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.progress {
  height: 3px;
  background: linear-gradient(
    to right,
    var(--accent) calc(var(--progress) * 100%),
    transparent calc(var(--progress) * 100%)
  );
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.title,
.meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-weight: 600;
}

.meta {
  font-size: 0.8em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  gap: 0.35rem;
}

.controls button {
  width: 2.6rem;
  height: 2.6rem;
  border: none;
  border-radius: 50%;
  background: var(--surface-2);
  cursor: pointer;
}

.controls .main {
  background: var(--accent);
  color: var(--accent-text);
}

.skip-verse {
  display: block;
  margin: 0.5rem auto 0;
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  cursor: pointer;
}

.secondary {
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem;
  padding-top: 0;
}

.pill,
.speed button {
  padding: 0.35rem 0.65rem;
  border: none;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.85rem;
  cursor: pointer;
}

.speed {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}

.pill:disabled,
.controls button:disabled,
.speed button:disabled {
  opacity: 0.35;
  cursor: default;
}

.speed-value {
  min-width: 3.4rem;
  font-variant-numeric: tabular-nums;
}

.ball-toggle[aria-pressed='false'] {
  opacity: 0.55;
  text-decoration: line-through;
}

.ball-toggle[aria-pressed='true'] {
  color: var(--accent);
}
</style>
