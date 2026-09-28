<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import KaraokePlayer from '../components/KaraokePlayer.vue'
import { parseKfn } from '../kfn/parseKfn'
import { loadSong, type KaraokeSong } from '../kfn/song'
import { makeDemoKfn, makeDuetDemoKfn } from './demoSong'

/**
 * A KaraokePlayer that loads its own song, for stories. Songs hold their audio
 * as bytes, and Histoire deep-walks every binding of a story on each state
 * change, so a song in the story itself freezes the browser. Other props and
 * listeners go to the player.
 */
const props = defineProps<{
  demo?: 'solo' | 'duet' | 'encrypted'
  /** A .kfn file picked in the story; takes precedence over `demo`. */
  file?: File | null
}>()

const DEMOS = {
  solo: () => makeDemoKfn(),
  duet: () => makeDuetDemoKfn(),
  encrypted: () => makeDemoKfn({ encrypted: true }),
}

const song = shallowRef<KaraokeSong | null>(null)
watch(
  () => [props.demo, props.file] as const,
  async ([demo, file], _, onCleanup) => {
    let stale = false
    onCleanup(() => (stale = true))
    song.value = null
    const bytes = file ? await file.arrayBuffer() : demo ? DEMOS[demo]() : null
    if (bytes && !stale) song.value = loadSong(parseKfn(bytes))
  },
  { immediate: true },
)
</script>

<template>
  <KaraokePlayer v-if="song" :song="song" />
</template>
