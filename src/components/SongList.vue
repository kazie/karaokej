<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Song } from '../shared/protocol'
import { songDetails } from '../format'

const props = defineProps<{ songs: Song[]; loading?: boolean; hasMore?: boolean }>()
const emit = defineEmits<{ select: [song: Song]; loadMore: [] }>()

const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | undefined

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) emit('loadMore')
  })
  if (sentinel.value) observer.observe(sentinel.value)
})

/** Whether the end of the list is on screen right now (measured, not from the last observer event). */
function atEnd(): boolean {
  const el = sentinel.value
  return !!el && el.getBoundingClientRect().top <= window.innerHeight
}

// The observer fires only when the end comes into view. If that happened while a
// page was loading (and got ignored), or a page was too short to push the end off
// screen, ask again once loading finishes.
watch(
  () => props.loading,
  (loading) => {
    if (!loading && props.hasMore && atEnd()) emit('loadMore')
  },
  { flush: 'post' },
)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <ul class="songs">
    <li v-for="song in songs" :key="song.id">
      <button type="button" class="song" @click="emit('select', song)">
        <span class="title">{{ song.title }}</span>
        <span class="meta">{{ songDetails(song) }}</span>
      </button>
    </li>
  </ul>
  <div ref="sentinel" class="sentinel" aria-hidden="true" />
  <p v-if="loading" class="status">Loading…</p>
  <p v-else-if="!songs.length" class="status">No songs found.</p>
  <p v-else-if="!hasMore" class="status end">That's all.</p>
</template>

<style scoped>
.songs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.song {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 100%;
  padding: 0.7rem 0.85rem;
  border: none;
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.song:hover,
.song:focus-visible {
  background: var(--surface-2);
}

.title {
  font-weight: 600;
}

.meta {
  font-size: 0.85em;
  color: var(--muted);
}

.sentinel {
  height: 1px;
}

.status {
  text-align: center;
  color: var(--muted);
}

.end {
  font-size: 0.85em;
}
</style>
