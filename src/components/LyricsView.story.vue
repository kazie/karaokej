<script setup lang="ts">
import { computed, reactive } from 'vue'
import LyricsDemo from '../demo/LyricsDemo.vue'
import { makeDemoKfn } from '../demo/demoSong'
import { parseKfn } from '../kfn/parseKfn'
import type { LyricsStyle } from '../kfn/parseSongIni'
import { loadSong } from '../kfn/song'

const timeline = loadSong(parseKfn(makeDemoKfn())).lyrics[0]!.timeline
const firstLineStart = timeline.lines.find((l) => l.syllables.length)?.start ?? 0
const lastLineEnd = timeline.lines.findLast((l) => l.syllables.length)?.end ?? 0

// Only settings live here; the animation clock runs inside LyricsDemo.
const state = reactive({
  playing: true,
  // Start mid-way through the first line so the highlight is visible straight away.
  seekMs: firstLineStart + 700,
  fontScale: 0.3,
  compact: false,
  ball: true,
  // KaraFun styles: "active" is sung text, "inactive" is not yet sung; frames are the outlines.
  activeColor: '#c7e55c',
  inactiveColor: '#f9f8f4',
  frameColor: '#010101',
  inactiveFrameColor: '#1e4d42',
  fontFamily: 'Arial',
  fontSize: 18,
  alignment: 'center' as LyricsStyle['alignment'],
})

const style = computed<Partial<LyricsStyle>>(() => ({
  activeColor: state.activeColor,
  inactiveColor: state.inactiveColor,
  frameColor: state.frameColor,
  inactiveFrameColor: state.inactiveFrameColor,
  fontFamily: state.fontFamily,
  fontSize: state.fontSize,
  alignment: state.alignment,
}))

const fonts = ['Arial', 'Verdana', 'Georgia', 'Trebuchet MS', 'Courier New', 'Comic Sans MS'].map((f) => ({
  label: f,
  value: f,
}))
const alignments = ['left', 'center', 'right'].map((a) => ({ label: a, value: a }))
</script>

<template>
  <Story title="Screen/LyricsView" :layout="{ type: 'single', iframe: true }">
    <Variant title="Demo song">
      <div class="stage">
        <LyricsDemo
          :playing="state.playing"
          :seek-ms="state.seekMs"
          :style="style"
          :font-scale="state.fontScale"
          :compact="state.compact"
          :ball="state.ball"
        />
      </div>
      <template #controls>
        <HstCheckbox v-model="state.playing" title="Playing" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
        <HstSlider v-model="state.seekMs" title="Jump to (ms)" :min="0" :max="lastLineEnd" :step="100" />
        <HstColorSelect v-model="state.activeColor" title="Sung color" />
        <HstColorSelect v-model="state.inactiveColor" title="Not yet sung color" />
        <HstColorSelect v-model="state.frameColor" title="Sung outline" />
        <HstColorSelect v-model="state.inactiveFrameColor" title="Not yet sung outline" />
        <HstSelect v-model="state.fontFamily" title="Font" :options="fonts" />
        <HstSlider v-model="state.fontSize" title="Font size (KaraFun points)" :min="8" :max="40" :step="1" />
        <HstSlider v-model="state.fontScale" title="Font scale" :min="0.1" :max="1" :step="0.05" />
        <HstButtonGroup v-model="state.alignment" title="Alignment" :options="alignments" />
        <HstCheckbox v-model="state.compact" title="Compact (duet band)" />
      </template>
    </Variant>
  </Story>
</template>

<style scoped>
/* The lyrics size themselves from the nearest size container, as on the player stage. */
.stage {
  position: relative;
  container-type: size;
  aspect-ratio: 4 / 3;
  max-width: 48rem;
  background: linear-gradient(135deg, #1b2a4a, #6a2c70);
}
</style>
