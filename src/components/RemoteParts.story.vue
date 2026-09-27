<script setup lang="ts">
import { reactive } from 'vue'
import NowPlayingBar from './NowPlayingBar.vue'
import QueueList from './QueueList.vue'
import SongList from './SongList.vue'
import { initialState } from '../shared/session'
import type { QueueItem, SessionState, Song } from '../shared/protocol'

const song = (id: string, title: string, artist: string, album = ''): Song => ({
  id,
  title,
  artist,
  album,
  category: 'Demo',
  path: '',
})
const songs = Array.from({ length: 12 }, (_, i) =>
  song(`s${i}`, `Song number ${i + 1}`, `Artist ${i % 4}`, 'Album'),
)
const queue: QueueItem[] = songs.slice(0, 4).map((s, i) => ({
  id: `q${i}`,
  song: s,
  singer: i % 2 ? 'Alex' : undefined,
  addedAt: 0,
  ball: true,
}))
const state = reactive<SessionState>({
  ...initialState(),
  queue,
  current: {
    id: 'c',
    song: song('x', 'A Very Long Song Title That Needs Truncating', 'Artist'),
    singer: 'Sam',
    addedAt: 0,
    ball: true,
  },
  status: 'playing',
  positionMs: 42_000,
  durationMs: 210_000,
  screens: 1,
})
</script>

<template>
  <Story title="Remote/Parts" :layout="{ type: 'single', iframe: true }">
    <Variant title="Song list">
      <div class="phone"><SongList :songs="songs" has-more /></div>
    </Variant>
    <Variant title="Queue">
      <div class="phone"><QueueList :queue="queue" /></div>
    </Variant>
    <Variant title="Now playing bar">
      <div class="phone">
        <NowPlayingBar
          :state="state"
          @pause="state.status = 'paused'"
          @resume="state.status = 'playing'"
          @restart="state.positionMs = 0"
        />
      </div>
      <template #controls>
        <HstSelect v-model="state.status" title="Status" :options="['loading', 'playing', 'paused']" />
      </template>
    </Variant>
  </Story>
</template>

<style scoped>
.phone {
  max-width: 390px;
  padding: 1rem;
  background: var(--bg);
}
</style>
