<script setup lang="ts">
import RemoteView from './RemoteView.vue'
import ServicesProvider from '../demo/ServicesProvider.vue'
import { createFakeBackend } from '../demo/fakeBackend'

const busy = createFakeBackend({ queued: [3, 10, 21, 30] })
const empty = createFakeBackend()
const noScreen = createFakeBackend({ screens: 0, queued: [5] })
const offline = createFakeBackend({ queued: [3, 10], connected: false })
const indexing = createFakeBackend({ scan: { running: true, done: 812, total: 2228 } })
</script>

<template>
  <Story title="Remote/RemoteView" :layout="{ type: 'single', iframe: true }">
    <Variant title="Search and queue">
      <div class="phone">
        <ServicesProvider :services="busy.services"><RemoteView /></ServicesProvider>
      </div>
      <template #controls>
        <p class="note">
          Search (try “cafe”, “&amp;” or “mika &amp;”), filter by category, tap a song to queue it, then check
          the Queue tab. Playback buttons act on the shared queue.
        </p>
        <HstCheckbox v-model="busy.connected.value" title="Connected" />
      </template>
    </Variant>
    <Variant title="Nothing queued yet">
      <div class="phone">
        <ServicesProvider :services="empty.services"><RemoteView /></ServicesProvider>
      </div>
    </Variant>
    <Variant title="No screen device connected">
      <div class="phone">
        <ServicesProvider :services="noScreen.services"><RemoteView /></ServicesProvider>
      </div>
    </Variant>
    <Variant title="Reconnecting (phone woke from sleep)">
      <div class="phone">
        <ServicesProvider :services="offline.services"><RemoteView /></ServicesProvider>
      </div>
      <template #controls>
        <HstCheckbox v-model="offline.connected.value" title="Connected" />
      </template>
    </Variant>
    <Variant title="Indexing the library">
      <div class="phone">
        <ServicesProvider :services="indexing.services"><RemoteView /></ServicesProvider>
      </div>
    </Variant>
  </Story>
</template>

<style scoped>
.phone {
  width: 390px;
  height: 780px;
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
