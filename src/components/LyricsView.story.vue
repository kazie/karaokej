<script setup lang="ts">
import { computed, reactive } from 'vue'
import LyricsDemo from '../demo/LyricsDemo.vue'
import { DUET_LINES, GROUP_SINGERS, makeDemoKfn } from '../demo/demoSong'
import { parseKfn } from '../kfn/parseKfn'
import type { LyricsStyle } from '../kfn/parseSongIni'
import { loadSong } from '../kfn/song'
import {
  HIGHLIGHT_MODES,
  LEAD_IN_STEPS,
  OUTLINE_WIDTHS,
  type HighlightMode,
  type OutlineWidth,
} from '../shared/protocol'
import { DEFAULT_SETTINGS } from '../shared/session'

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
  leadInMs: DEFAULT_SETTINGS.leadInMs as number,
  highlight: 'wipe' as HighlightMode,
  outline: 'normal' as OutlineWidth,
  frameWidth: 3,
  colors: {
    activeColor: '#c7e55c',
    inactiveColor: '#f9f8f4',
    frameColor: '#010101',
    inactiveFrameColor: '#1e4d42',
  },
  // KaraFun colors are #RRGGBBAA; the color pickers have no alpha, so it has its own sliders.
  alpha: { activeColor: 1, inactiveColor: 1, frameColor: 1, inactiveFrameColor: 1 },
  /** A busy background, to see translucent lyrics against. */
  stripes: false,
  fontFamily: 'Arial',
  fontSize: 18,
  alignment: 'center' as LyricsStyle['alignment'],
  trajectory: 'PlainBottomToTop',
  fade: true,
})

/** KaraFun styles: "active" is sung text, "inactive" is not yet sung; frames are the outlines. */
const COLORS = [
  { key: 'activeColor', color: 'Sung color', alpha: 'Sung opacity' },
  { key: 'inactiveColor', color: 'Not yet sung color', alpha: 'Not yet sung opacity' },
  { key: 'frameColor', color: 'Sung outline', alpha: 'Sung outline opacity' },
  { key: 'inactiveFrameColor', color: 'Not yet sung outline', alpha: 'Not yet sung outline opacity' },
] as const

/**
 * Demos with a band per singer, each with its own settings. Both start in
 * their intro, where the lyrics are still hidden.
 */
const multi = [
  {
    demo: 'duet',
    title: 'Duet: one singer waits',
    note: "Singer one sings a verse, then singer two, then both sing the last line. With a lead-in, each band stays empty until shortly before its singer's turn, and the 6 s intro starts with no lyrics at all.",
    endMs: (DUET_LINES.first.at(-1)![0] + 300) * 10,
  },
  {
    demo: 'group',
    title: 'Group: a track per singer',
    note: 'Five singers with a track each, like group songs that have one per character. Only the singers with lines on screen get a band, labelled with their name; two share a line, then all sing the last one.',
    endMs: (GROUP_SINGERS[0].lines.at(-1)![0] + 300) * 10,
  },
].map((d) => ({
  ...d,
  demo: d.demo as 'duet' | 'group',
  state: reactive({
    playing: true,
    seekMs: 0,
    ball: true,
    leadInMs: DEFAULT_SETTINGS.leadInMs as number,
    highlight: 'wipe' as HighlightMode,
  }),
}))

/** `#RRGGBB` plus an alpha of 0..1 → KaraFun `#RRGGBBAA`. */
const withAlpha = (hex: string, alpha: number) =>
  hex.slice(0, 7) +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')

const style = computed<Partial<LyricsStyle>>(() => ({
  ...Object.fromEntries(COLORS.map(({ key }) => [key, withAlpha(state.colors[key], state.alpha[key])])),
  fontFamily: state.fontFamily,
  fontSize: state.fontSize,
  alignment: state.alignment,
  trajectory: state.trajectory,
  fade: state.fade,
  frameWidth: state.frameWidth,
}))

const fonts = ['Arial', 'Verdana', 'Georgia', 'Trebuchet MS', 'Courier New', 'Comic Sans MS'].map((f) => ({
  label: f,
  value: f,
}))
const leadIns = LEAD_IN_STEPS.map((ms) => ({ label: ms ? `${ms / 1000} s` : 'Always', value: ms }))
const highlights = HIGHLIGHT_MODES.map((m) => ({ label: m, value: m }))
const outlines = OUTLINE_WIDTHS.map((w) => ({ label: w, value: w }))
const alignments = ['left', 'center', 'right'].map((a) => ({ label: a, value: a }))
/** KaraFun trajectories we support: scroll up (the usual), scroll down, or a still page at a time. */
const motions = [
  { label: 'up', value: 'PlainBottomToTop' },
  { label: 'down', value: 'PlainTopToBottom' },
  { label: 'still', value: 'Still' },
]
</script>

<template>
  <Story title="Screen/LyricsView" :layout="{ type: 'single', iframe: true }">
    <Variant title="Demo song">
      <div class="stage" :class="{ stripes: state.stripes }">
        <LyricsDemo
          :playing="state.playing"
          :seek-ms="state.seekMs"
          :style="style"
          :font-scale="state.fontScale"
          :compact="state.compact"
          :ball="state.ball"
          :lead-in-ms="state.leadInMs"
          :highlight="state.highlight"
          :outline="state.outline"
        />
      </div>
      <template #controls>
        <HstCheckbox v-model="state.playing" title="Playing" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
        <HstSelect v-model="state.leadInMs" title="Show lyrics ahead" :options="leadIns" />
        <HstButtonGroup v-model="state.highlight" title="Highlight" :options="highlights" />
        <HstButtonGroup v-model="state.outline" title="Outline" :options="outlines" />
        <HstSlider v-model="state.frameWidth" title="FrameType level" :min="0" :max="6" :step="1" />
        <HstSlider v-model="state.seekMs" title="Jump to (ms)" :min="0" :max="lastLineEnd" :step="100" />
        <HstColorSelect v-for="c in COLORS" :key="c.key" v-model="state.colors[c.key]" :title="c.color" />
        <HstSlider
          v-for="c in COLORS"
          :key="c.key"
          v-model="state.alpha[c.key]"
          :title="c.alpha"
          :min="0"
          :max="1"
          :step="0.05"
        />
        <HstCheckbox v-model="state.stripes" title="Striped background (see through the lyrics)" />
        <HstSelect v-model="state.fontFamily" title="Font" :options="fonts" />
        <HstSlider v-model="state.fontSize" title="Font size (KaraFun points)" :min="8" :max="40" :step="1" />
        <HstSlider v-model="state.fontScale" title="Font scale" :min="0.1" :max="1" :step="0.05" />
        <HstButtonGroup v-model="state.alignment" title="Alignment" :options="alignments" />
        <HstButtonGroup v-model="state.trajectory" title="Motion" :options="motions" />
        <HstCheckbox v-model="state.fade" title="Fade lines in and out" />
        <HstCheckbox v-model="state.compact" title="Compact (duet band)" />
      </template>
    </Variant>
    <Variant v-for="d in multi" :key="d.demo" :title="d.title">
      <div class="stage">
        <LyricsDemo
          :demo="d.demo"
          :playing="d.state.playing"
          :seek-ms="d.state.seekMs"
          :ball="d.state.ball"
          :lead-in-ms="d.state.leadInMs"
          :highlight="d.state.highlight"
        />
      </div>
      <template #controls>
        <p class="note">{{ d.note }}</p>
        <HstCheckbox v-model="d.state.playing" title="Playing" />
        <HstSelect v-model="d.state.leadInMs" title="Show lyrics ahead" :options="leadIns" />
        <HstButtonGroup v-model="d.state.highlight" title="Highlight" :options="highlights" />
        <HstCheckbox v-model="d.state.ball" title="Bouncing ball" />
        <HstSlider v-model="d.state.seekMs" title="Jump to (ms)" :min="0" :max="d.endMs" :step="100" />
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

.stage.stripes {
  background: repeating-linear-gradient(90deg, #2f6fd6 0 2rem, #e0a030 2rem 4rem);
}

.note {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  opacity: 0.8;
}
</style>
