<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import KaraokePlayer from './KaraokePlayer.vue'
import { makeDemoKfn, makeDuetDemoKfn } from '../demo/demoSong'
import { parseKfn } from '../kfn/parseKfn'
import { speedLabel } from '../format'
import { loadSong } from '../kfn/song'
import { DEFAULT_SETTINGS, nextRequest } from '../shared/session'
import {
  HIGHLIGHT_MODES,
  LEAD_IN_STEPS,
  SEEK_STEP_MS,
  SPEED_STEPS,
  type HighlightMode,
  type NewPlaybackRequest,
  type PlaybackRequest,
} from '../shared/protocol'

const demo = loadSong(parseKfn(makeDemoKfn()))
const duetDemo = loadSong(parseKfn(makeDuetDemoKfn()))
const encryptedDemo = loadSong(parseKfn(makeDemoKfn({ encrypted: true })))
const local = shallowRef<ReturnType<typeof loadSong>>()
const state = reactive({
  paused: true,
  ball: true,
  autoSkip: false,
  leadInMs: DEFAULT_SETTINGS.leadInMs as number,
  highlight: 'wipe' as HighlightMode,
  playbackRate: 1,
  request: null as PlaybackRequest | null,
})
const leadIns = LEAD_IN_STEPS.map((ms) => ({ label: ms ? `${ms / 1000} s` : 'Always', value: ms }))
const highlights = HIGHLIGHT_MODES.map((m) => ({ label: m, value: m }))
/**
 * Fixed "Source" tab code. Histoire would otherwise generate it from the props
 * on every state change, serializing the song's audio bytes, which hangs the browser.
 */
const source = {
  controlled: `<KaraokePlayer :song="song" :paused="false" :lead-in-ms="3000" highlight="wipe" :ball="true" />`,
  paused: `<KaraokePlayer :song="song" paused controls />`,
}

const speeds = SPEED_STEPS.map((s) => ({ label: speedLabel(s), value: s }))

/** Mimic the session: each request gets the next sequence number. */
function send(req: NewPlaybackRequest): void {
  state.request = nextRequest(state.request, req)
}

async function onFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) local.value = loadSong(parseKfn(await file.arrayBuffer()))
}
</script>

<template>
  <Story title="Screen/KaraokePlayer" :layout="{ type: 'single', iframe: true }">
    <Variant title="Landscape (16:9)" :source="source.controlled">
      <div class="frame landscape">
        <KaraokePlayer :song="demo" v-bind="state" controls />
      </div>
      <template #controls>
        <p class="note">
          The demo has a countdown before the first line, an interlude with a progress bar, background changes
          (crossfade and cut), a zoom pulse, a color change and a shaking last line.
        </p>
        <HstCheckbox v-model="state.paused" title="Paused" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
        <HstCheckbox v-model="state.autoSkip" title="Auto-skip long interludes" />
        <HstSelect v-model="state.leadInMs" title="Show lyrics ahead" :options="leadIns" />
        <HstButtonGroup v-model="state.highlight" title="Highlight" :options="highlights" />
        <HstSelect v-model="state.playbackRate" title="Speed" :options="speeds" />
        <HstButton @click="send({ kind: 'restart' })">Restart</HstButton>
        <HstButton @click="send({ kind: 'seekBy', deltaMs: -SEEK_STEP_MS })">−10 s</HstButton>
        <HstButton @click="send({ kind: 'seekBy', deltaMs: SEEK_STEP_MS })">+10 s</HstButton>
        <HstButton @click="send({ kind: 'skipGap' })">Skip to next verse</HstButton>
      </template>
    </Variant>
    <Variant title="Portrait phone" :source="source.controlled">
      <div class="frame portrait">
        <KaraokePlayer :song="demo" v-bind="state" controls />
      </div>
      <template #controls>
        <HstCheckbox v-model="state.paused" title="Paused" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
      </template>
    </Variant>
    <Variant title="Duet: one singer waits" :source="source.controlled">
      <div class="frame landscape">
        <KaraokePlayer :song="duetDemo" v-bind="state" controls />
      </div>
      <template #controls>
        <p class="note">
          A 6 s intro, a verse for each singer, then the last line together. With a lead-in, the lyrics show
          up with the countdown, and each singer's band stays empty until shortly before their turn.
        </p>
        <HstCheckbox v-model="state.paused" title="Paused" />
        <HstSelect v-model="state.leadInMs" title="Show lyrics ahead" :options="leadIns" />
        <HstButtonGroup v-model="state.highlight" title="Highlight" :options="highlights" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
        <HstButton @click="send({ kind: 'restart' })">Restart</HstButton>
      </template>
    </Variant>
    <Variant title="Encrypted demo song" :source="source.paused">
      <div class="frame landscape">
        <KaraokePlayer :song="encryptedDemo" paused controls />
      </div>
    </Variant>
    <Variant title="Local .kfn file" :source="source.paused">
      <input type="file" accept=".kfn" @change="onFile" />
      <div v-if="local" class="frame landscape">
        <KaraokePlayer :song="local" paused controls />
      </div>
    </Variant>
  </Story>
</template>

<style scoped>
.frame {
  position: relative;
  margin-top: 0.5rem;
  background: #000;
}

.landscape {
  aspect-ratio: 16 / 9;
  max-width: 60rem;
}

.portrait {
  width: 360px;
  height: 740px;
}

.note {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  line-height: 1.4;
}
</style>
