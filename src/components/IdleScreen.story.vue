<script setup lang="ts">
import IdleScreen from './IdleScreen.vue'
import type { QueueItem, ScanStatus } from '../shared/protocol'

const song = (id: string, title: string, artist: string) => ({
  id,
  title,
  artist,
  album: '',
  category: 'Demo',
  path: '',
})
const queue: QueueItem[] = [
  { id: '1', song: song('a', 'First Song', 'Some Artist'), singer: 'Alex', addedAt: 0, ball: true },
  { id: '2', song: song('b', 'Second Song', 'Another Artist'), addedAt: 0, ball: true },
  { id: '3', song: song('c', 'Third Song', 'Band'), singer: 'Sam', addedAt: 0, ball: true },
]
const scan: ScanStatus = {
  running: true,
  done: 812,
  total: 2228,
  songCount: 812,
  lastFinishedAt: null,
  lastError: null,
}
const url = 'http://karaokej.local:3000/remote'
</script>

<template>
  <Story title="Screen/IdleScreen" :layout="{ type: 'single', iframe: true }">
    <Variant title="Empty">
      <div class="frame"><IdleScreen :url="url" :queue="[]" /></div>
    </Variant>
    <Variant title="With queue">
      <div class="frame"><IdleScreen :url="url" :queue="queue" /></div>
    </Variant>
    <Variant title="Indexing and loading">
      <div class="frame"><IdleScreen :url="url" :queue="queue" :scan="scan" loading="First Song" /></div>
    </Variant>
  </Story>
</template>

<style scoped>
.frame {
  position: relative;
  height: 100vh;
}
</style>
