<script setup lang="ts">
import QrCode from './QrCode.vue'
import { queuedDetails } from '../format'
import type { QueueItem, ScanStatus } from '../shared/protocol'

defineProps<{
  url: string
  queue: QueueItem[]
  scan?: ScanStatus | null
  loading?: string | null
}>()
</script>

<template>
  <div class="idle">
    <div class="qr-card">
      <QrCode :value="url" label="Scan to open the karaoke remote" />
    </div>
    <div class="text">
      <h1>Karaoke<span>j</span></h1>
      <p v-if="loading" class="lead">
        Loading <strong>{{ loading }}</strong
        >…
      </p>
      <p v-else class="lead">Scan the code to pick a song</p>
      <p class="url">{{ url }}</p>
      <p v-if="scan?.running" class="scan">Indexing library… {{ scan.done }} / {{ scan.total || '?' }}</p>
      <section v-if="queue.length" class="next">
        <h2>Up next</h2>
        <ol>
          <li v-for="item in queue.slice(0, 5)" :key="item.id">
            <span class="title">{{ item.song.title }}</span>
            <span class="meta">{{ queuedDetails(item.song, item.singer) }}</span>
          </li>
        </ol>
        <p v-if="queue.length > 5" class="more">+ {{ queue.length - 5 }} more</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.idle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(1.5rem, 5vmin, 5rem);
  padding: clamp(1rem, 5vmin, 4rem);
  background:
    radial-gradient(ellipse at top left, #2a3553, transparent 60%),
    radial-gradient(ellipse at bottom right, #4a2350, transparent 60%), var(--bg);
  overflow: hidden;
}

.qr-card {
  flex: none;
  width: min(60vh, 42vw);
  padding: clamp(0.5rem, 1.5vmin, 1.25rem);
  border-radius: calc(var(--radius) * 1.5);
  background: #fff;
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.45);
}

.text {
  min-width: 0;
  max-width: 40rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 8vmin, 6rem);
  letter-spacing: -0.03em;
  line-height: 1;
}

h1 span {
  color: var(--accent);
}

.lead {
  margin: 0.5em 0 0.25em;
  font-size: clamp(1.1rem, 4vmin, 2.6rem);
  font-weight: 600;
}

.url {
  margin: 0;
  font-size: clamp(0.9rem, 2.2vmin, 1.4rem);
  color: var(--muted);
  word-break: break-all;
}

.scan {
  color: var(--warning);
  font-size: clamp(0.8rem, 2vmin, 1.2rem);
}

.next {
  margin-top: clamp(1rem, 4vmin, 3rem);
}

h2 {
  margin: 0 0 0.4em;
  font-size: clamp(0.9rem, 2.4vmin, 1.5rem);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

ol {
  margin: 0;
  padding-left: 1.4em;
  font-size: clamp(0.9rem, 2.6vmin, 1.7rem);
}

li + li {
  margin-top: 0.35em;
}

.title {
  font-weight: 600;
}

.meta {
  display: block;
  font-size: 0.75em;
  color: var(--muted);
}

.more {
  color: var(--muted);
  font-size: clamp(0.8rem, 2vmin, 1.2rem);
}

@media (orientation: portrait) {
  .idle {
    flex-direction: column;
    text-align: center;
  }

  .qr-card {
    width: min(70vw, 45vh);
  }

  ol {
    display: inline-block;
    text-align: left;
  }
}
</style>
