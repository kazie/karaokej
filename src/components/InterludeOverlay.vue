<script setup lang="ts">
import { computed } from 'vue'
import type { Clock } from '../composables/useKeyframe'
import { countdownStart, type Gap } from '../kfn/timeline'

/** Gaps shorter than this before the countdown get no progress bar. */
const MIN_BAR_MS = 2000

/** Progress through an instrumental gap, then a 3-2-1 countdown to the next line. */
const props = defineProps<{
  gap: Gap | null
  /** Current song position (ms). */
  clock: Clock
  /** Color of the bar and numbers (the lyrics' sung color). */
  color: string
}>()

const state = computed(() => {
  const gap = props.gap
  if (!gap) return null
  const barEnd = countdownStart(gap)
  const t = props.clock() // only read inside a gap, so nothing re-renders outside gaps
  if (t >= barEnd) return { kind: 'countdown' as const, n: Math.max(1, Math.ceil((gap.endMs - t) / 1000)) }
  // Only worth a progress bar when there is something to wait for before the countdown.
  if (barEnd - gap.startMs < MIN_BAR_MS) return null
  return { kind: 'bar' as const, progress: (t - gap.startMs) / (barEnd - gap.startMs) }
})
</script>

<template>
  <div class="interlude" :style="{ '--color': color }" aria-hidden="true">
    <Transition name="pop" mode="out-in">
      <div v-if="state?.kind === 'bar'" key="bar" class="bar">
        <span class="note">♪</span>
        <span class="track"><span class="done" :style="{ transform: `scaleX(${state.progress})` }" /></span>
      </div>
      <div v-else-if="state?.kind === 'countdown'" :key="`n${state.n}`" class="countdown">{{ state.n }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.interlude {
  position: absolute;
  inset-inline: 0;
  /* Below the song title card (top ~12–28%) and just above the upcoming line (~45%). */
  top: 31%;
  display: flex;
  justify-content: center;
  pointer-events: none;
  font-family: system-ui, sans-serif;
}

.bar {
  display: flex;
  align-items: center;
  gap: 1.2cqh;
  width: min(50cqw, 60cqh);
  padding: 1cqh 2cqh;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.45);
}

.note {
  color: var(--color);
  font-size: 3.5cqh;
  line-height: 1;
}

.track {
  flex: 1;
  height: 1cqh;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.25);
  overflow: hidden;
}

.done {
  display: block;
  height: 100%;
  background: var(--color);
  transform-origin: left;
}

.countdown {
  display: grid;
  place-items: center;
  width: 11cqh;
  height: 11cqh;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.5);
  border: 0.6cqh solid var(--color);
  color: #fff;
  font-size: 7cqh;
  font-weight: 800;
  animation: pulse 1s ease-out;
}

@keyframes pulse {
  from {
    transform: scale(1.35);
    opacity: 0.4;
  }
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.2s;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}
</style>
