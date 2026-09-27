<script setup lang="ts">
import type { QueueItem } from '../shared/protocol'
import { queuedDetails } from '../format'

defineProps<{ queue: QueueItem[] }>()
const emit = defineEmits<{
  move: [itemId: string, toIndex: number]
  remove: [itemId: string]
  playNow: [itemId: string]
  ball: [itemId: string, enabled: boolean]
}>()
</script>

<template>
  <ol v-if="queue.length" class="queue">
    <li v-for="(item, index) in queue" :key="item.id" class="item">
      <span class="pos">{{ index + 1 }}</span>
      <span class="info">
        <span class="title">{{ item.song.title }}</span>
        <span class="meta">{{ queuedDetails(item.song, item.singer) }}</span>
      </span>
      <span class="actions">
        <button
          type="button"
          :disabled="index === 0"
          aria-label="Move up"
          @click="emit('move', item.id, index - 1)"
        >
          ↑
        </button>
        <button
          type="button"
          :disabled="index === queue.length - 1"
          aria-label="Move down"
          @click="emit('move', item.id, index + 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="ball"
          :aria-pressed="item.ball"
          :aria-label="
            item.ball ? 'Bouncing ball on (tap to turn off)' : 'Bouncing ball off (tap to turn on)'
          "
          @click="emit('ball', item.id, !item.ball)"
        >
          ●
        </button>
        <button type="button" aria-label="Play now" @click="emit('playNow', item.id)">▶</button>
        <button type="button" aria-label="Remove" class="remove" @click="emit('remove', item.id)">✕</button>
      </span>
    </li>
  </ol>
  <p v-else class="empty">The queue is empty. Find a song and add it!</p>
</template>

<style scoped>
.queue {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem;
  border-radius: var(--radius);
  background: var(--surface);
}

.pos {
  width: 1.5rem;
  text-align: center;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
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
  font-size: 0.85em;
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 0.2rem;
}

.actions button {
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--surface-2);
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.3;
  cursor: default;
}

.actions .remove {
  color: var(--danger);
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 2rem 0;
}

.actions .ball[aria-pressed='true'] {
  color: var(--accent);
}

.actions .ball[aria-pressed='false'] {
  opacity: 0.4;
}
</style>
