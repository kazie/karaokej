<script setup lang="ts">
import RemoteView from './RemoteView.vue'
import ScreenView from './ScreenView.vue'
import ServicesProvider from '../demo/ServicesProvider.vue'
import { createFakeBackend } from '../demo/fakeBackend'

const idle = createFakeBackend()
const waiting = createFakeBackend({ queued: [3, 10, 21], screens: 1 })
const party = createFakeBackend()
</script>

<template>
  <Story title="Screen/ScreenView" :layout="{ type: 'single', iframe: true }">
    <Variant title="Idle">
      <div class="tv">
        <ServicesProvider :services="idle.services"><ScreenView /></ServicesProvider>
      </div>
    </Variant>
    <Variant title="Song queued, waiting for Start">
      <div class="tv">
        <ServicesProvider :services="waiting.services"><ScreenView /></ServicesProvider>
      </div>
      <template #controls>
        <p class="note">
          Press Start (windowed) to play the demo song: title card, lyrics, and “Up next” near the end.
        </p>
      </template>
    </Variant>
    <Variant title="Party: screen device and remote phone">
      <div class="party">
        <ServicesProvider :services="party.services">
          <div class="tv"><ScreenView /></div>
          <div class="phone"><RemoteView /></div>
        </ServicesProvider>
      </div>
      <template #controls>
        <p class="note">
          Both share one fake server. Press Start on the screen, then queue songs, pause or skip from the
          phone. Songs ending in “&amp; Friends” are duets; try the lyrics settings under ⚙ with one.
        </p>
        <HstCheckbox v-model="party.connected.value" title="Network up" />
      </template>
    </Variant>
  </Story>
</template>

<style scoped>
/* ScreenView is position: fixed; a transform makes this box its containing block. */
.tv {
  position: relative;
  flex: 1;
  aspect-ratio: 16 / 9;
  max-width: 64rem;
  overflow: hidden;
  transform: translateZ(0);
  background: #000;
}

.party {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.phone {
  flex: none;
  width: 360px;
  height: 640px;
  overflow: auto;
  background: var(--bg);
  border-radius: 1.5rem;
  outline: 1px solid var(--surface-2);
}

.note {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  line-height: 1.4;
}
</style>
