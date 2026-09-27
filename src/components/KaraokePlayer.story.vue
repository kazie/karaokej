<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import KaraokePlayer from './KaraokePlayer.vue'
import { makeDemoKfn } from '../demo/demoSong'
import { parseKfn } from '../kfn/parseKfn'
import { speedLabel } from '../format'
import { loadSong } from '../kfn/song'
import { nextRequest } from '../shared/session'
import { SEEK_STEP_MS, SPEED_STEPS, type NewPlaybackRequest, type PlaybackRequest } from '../shared/protocol'

const demo = loadSong(parseKfn(makeDemoKfn()))
const encryptedDemo = loadSong(parseKfn(makeDemoKfn({ encrypted: true })))
const local = shallowRef<ReturnType<typeof loadSong>>()
const state = reactive({
  paused: true,
  ball: true,
  autoSkip: false,
  playbackRate: 1,
  request: null as PlaybackRequest | null,
})
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
    <Variant title="Landscape (16:9)">
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
        <HstSelect v-model="state.playbackRate" title="Speed" :options="speeds" />
        <HstButton @click="send({ kind: 'restart' })">Restart</HstButton>
        <HstButton @click="send({ kind: 'seekBy', deltaMs: -SEEK_STEP_MS })">−10 s</HstButton>
        <HstButton @click="send({ kind: 'seekBy', deltaMs: SEEK_STEP_MS })">+10 s</HstButton>
        <HstButton @click="send({ kind: 'skipGap' })">Skip to next verse</HstButton>
      </template>
    </Variant>
    <Variant title="Portrait phone">
      <div class="frame portrait">
        <KaraokePlayer :song="demo" v-bind="state" controls />
      </div>
      <template #controls>
        <HstCheckbox v-model="state.paused" title="Paused" />
        <HstCheckbox v-model="state.ball" title="Bouncing ball" />
      </template>
    </Variant>
    <Variant title="Encrypted demo song">
      <div class="frame landscape">
        <KaraokePlayer :song="encryptedDemo" paused controls />
      </div>
    </Variant>
    <Variant title="Local .kfn file">
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
