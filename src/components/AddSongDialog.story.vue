<script setup lang="ts">
import { reactive } from 'vue'
import AddSongDialog from './AddSongDialog.vue'
import type { Song } from '../shared/protocol'

const song: Song = {
  id: 's1',
  title: 'Midnight Parade',
  artist: 'Aurora Lane',
  album: 'Neon Skies',
  category: 'Pop',
  subcategory: '',
  path: '',
}
const state = reactive({ selected: null as Song | null, log: [] as string[] })

function add(singer: string): void {
  state.log.unshift(`Added “${song.title}”${singer ? ` for ${singer}` : ''}`)
  state.selected = null
}
</script>

<template>
  <Story title="Remote/AddSongDialog" :layout="{ type: 'single', iframe: true }">
    <Variant title="Queue a song">
      <div class="phone">
        <button type="button" class="btn-primary" @click="state.selected = song">Tap a song</button>
        <p class="hint">The singer name is remembered on this device for next time.</p>
        <ul>
          <li v-for="entry in state.log" :key="entry">{{ entry }}</li>
        </ul>
        <AddSongDialog :song="state.selected" @add="add" @close="state.selected = null" />
      </div>
    </Variant>
  </Story>
</template>

<style scoped>
.phone {
  max-width: 390px;
  min-height: 500px;
  padding: 1rem;
  background: var(--bg);
}

.hint {
  color: var(--muted);
  font-size: 0.9em;
}
</style>
