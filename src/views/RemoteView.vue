<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import AddSongDialog from '../components/AddSongDialog.vue'
import ChipScroller from '../components/ChipScroller.vue'
import NowPlayingBar from '../components/NowPlayingBar.vue'
import QueueList from '../components/QueueList.vue'
import SongList from '../components/SongList.vue'
import { useServices } from '../services'
import { errorMessage, isAbortError } from '../shared/errors'
import {
  LEAD_IN_STEPS,
  type CategoryCount,
  type ClientCommand,
  type HighlightMode,
  type Song,
} from '../shared/protocol'

const { connect, searchSongs, getCategories } = useServices()
const { state, connected, error, send, reconnectNow } = connect('remote')

const tab = ref<'search' | 'queue'>('search')
const query = ref('')
/** `null` = all categories; `''` = songs in the library root. */
const category = ref<string | null>(null)
const categories = shallowRef<CategoryCount[]>([])
const songs = shallowRef<Song[]>([])
const total = ref(0)
const loading = ref(false)
const selected = shallowRef<Song | null>(null)
const toast = ref<string | null>(null)
const showSettings = ref(false)

const hasMore = computed(() => songs.value.length < total.value)
const queueCount = computed(() => state.value?.queue.length ?? 0)

let controller: AbortController | undefined
let debounce: ReturnType<typeof setTimeout> | undefined

async function load(reset: boolean): Promise<void> {
  if (!reset && (loading.value || !hasMore.value)) return
  controller?.abort()
  const current = (controller = new AbortController())
  loading.value = true
  try {
    const page = await searchSongs(
      { q: query.value, category: category.value, offset: reset ? 0 : songs.value.length },
      current.signal,
    )
    songs.value = reset ? page.songs : [...songs.value, ...page.songs]
    total.value = page.total
  } catch (e) {
    if (!isAbortError(e)) showToast(`Search failed: ${errorMessage(e)}`)
  } finally {
    // A newer search may have replaced this one; it owns the loading flag now.
    if (controller === current) loading.value = false
  }
}

watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => load(true), 250)
})
watch(category, () => load(true))

onMounted(async () => {
  load(true)
  categories.value = await getCategories().catch(() => [])
})

// Refresh the catalog when an index scan finishes.
watch(
  () => state.value?.scan.lastFinishedAt,
  (finished, previous) => {
    // `previous` is undefined until the first state arrives, and null before any scan finished.
    if (finished && previous !== undefined && finished !== previous) {
      load(true)
      getCategories().then(
        (c) => (categories.value = c),
        () => {},
      )
    }
  },
)

watch(error, (message) => {
  if (message) showToast(message)
  error.value = null
})

let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2500)
}

/** Commands are never queued: a pause or skip replayed later could hit the wrong song. */
function command(cmd: ClientCommand): boolean {
  if (send(cmd)) return true
  showToast('Reconnecting… try again in a moment')
  reconnectNow()
  return false
}

function toggleAutoSkip(event: Event): void {
  const box = event.target as HTMLInputElement
  // Not sent (disconnected): show the setting as it really is.
  if (!command({ type: 'setAutoSkip', enabled: box.checked }))
    box.checked = !!state.value?.settings.autoSkipInterludes
}

const leadInLabel = (ms: number) => (ms ? `${ms / 1000} s before` : 'Always')

function changeLeadIn(event: Event): void {
  const select = event.target as HTMLSelectElement
  if (!command({ type: 'setLeadIn', ms: Number(select.value) }))
    select.value = String(state.value?.settings.leadInMs ?? '')
}

function changeHighlight(event: Event): void {
  const select = event.target as HTMLSelectElement
  if (!command({ type: 'setHighlight', mode: select.value as HighlightMode }))
    select.value = state.value?.settings.highlight ?? ''
}

function addSelected(singer: string, ball: boolean): void {
  if (!selected.value) return
  // On failure the dialog stays open so the user can retry once reconnected.
  if (!command({ type: 'enqueue', songId: selected.value.id, singer: singer || undefined, ball })) return
  showToast(`Added “${selected.value.title}”`)
  selected.value = null
}
</script>

<template>
  <div class="remote">
    <header class="header">
      <h1>Karaoke<span>j</span></h1>
      <span class="header-right">
        <button
          type="button"
          class="settings-toggle"
          :aria-expanded="showSettings"
          aria-label="Settings"
          @click="showSettings = !showSettings"
        >
          ⚙
        </button>
        <span class="conn" :class="{ on: connected }" :title="connected ? 'Connected' : 'Reconnecting…'" />
      </span>
    </header>
    <section v-if="showSettings && state" class="settings" aria-label="Settings">
      <label>
        <input type="checkbox" :checked="state.settings.autoSkipInterludes" @change="toggleAutoSkip" />
        Auto-skip long intros and interludes
      </label>
      <label>
        Show lyrics
        <select :value="state.settings.leadInMs" @change="changeLeadIn">
          <option v-for="ms in LEAD_IN_STEPS" :key="ms" :value="ms">{{ leadInLabel(ms) }}</option>
        </select>
      </label>
      <label>
        Highlight
        <select :value="state.settings.highlight" @change="changeHighlight">
          <option value="wipe">Sliding</option>
          <option value="instant">Whole syllables</option>
        </select>
      </label>
      <p class="settings-note">These settings apply for everyone.</p>
    </section>

    <p v-if="state && !connected" class="banner warning" role="status">Reconnecting to the karaoke server…</p>
    <p v-if="state && state.screens === 0" class="banner warning">
      No karaoke screen is connected. Open <strong>/screen</strong> on the TV or computer.
    </p>
    <p v-if="state?.scan.running" class="banner">
      Indexing library… {{ state.scan.done }} / {{ state.scan.total || '?' }}
    </p>
    <p v-if="state?.lastError" class="banner warning">{{ state.lastError }}</p>

    <nav class="tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'search'" @click="tab = 'search'">
        Songs
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'queue'" @click="tab = 'queue'">
        Queue <span v-if="queueCount" class="badge">{{ queueCount }}</span>
      </button>
    </nav>

    <main class="content">
      <section v-show="tab === 'search'" class="search">
        <input
          v-model="query"
          type="search"
          class="query"
          placeholder="Search title, artist, album…"
          aria-label="Search songs"
          enterkeyhint="search"
        />
        <ChipScroller label="Category" prev-label="Previous categories" next-label="Next categories">
          <button
            type="button"
            role="radio"
            class="chip"
            :aria-checked="category === null"
            @click="category = null"
          >
            All
          </button>
          <button
            v-for="c in categories"
            :key="c.category"
            type="button"
            role="radio"
            class="chip"
            :aria-checked="category === c.category"
            @click="category = c.category"
          >
            {{ c.category || 'Other' }} <span class="count">{{ c.count }}</span>
          </button>
        </ChipScroller>
        <p class="total">{{ total }} songs</p>
        <SongList
          :songs="songs"
          :loading="loading"
          :has-more="hasMore"
          @select="selected = $event"
          @load-more="load(false)"
        />
      </section>

      <section v-show="tab === 'queue'">
        <QueueList
          :queue="state?.queue ?? []"
          @move="(itemId, toIndex) => command({ type: 'move', itemId, toIndex })"
          @remove="(itemId) => command({ type: 'remove', itemId })"
          @play-now="(itemId) => command({ type: 'playNow', itemId })"
          @ball="(itemId, enabled) => command({ type: 'setBall', itemId, enabled })"
        />
      </section>
    </main>

    <footer class="footer">
      <Transition name="fade">
        <p v-if="toast" class="toast" role="status">{{ toast }}</p>
      </Transition>
      <NowPlayingBar
        v-if="state"
        :state="state"
        @pause="command({ type: 'pause' })"
        @resume="command({ type: 'resume' })"
        @restart="command({ type: 'restart' })"
        @skip="command({ type: 'skip' })"
        @seek="(deltaMs) => command({ type: 'seekBy', deltaMs })"
        @speed="(rate) => command({ type: 'setSpeed', rate })"
        @ball="(enabled) => state?.current && command({ type: 'setBall', itemId: state.current.id, enabled })"
        @skip-interlude="command({ type: 'skipInterlude' })"
      />
    </footer>

    <AddSongDialog :song="selected" @add="addSelected" @close="selected = null" />
  </div>
</template>

<style scoped>
.remote {
  --fade-duration: 0.2s;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 40rem;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 1rem 0.5rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

h1 span {
  color: var(--accent);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.settings-toggle {
  border: none;
  background: none;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}

.settings-toggle[aria-expanded='true'] {
  opacity: 1;
  color: var(--accent);
}

.settings {
  margin: 0.25rem 1rem;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 0.9em;
}

.settings label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}

.settings label + label {
  margin-top: 0.6rem;
}

.settings input {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--accent);
}

.settings select {
  margin-left: auto;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--surface-2);
  border-radius: calc(var(--radius) / 2);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
}

.settings-note {
  margin: 0.6rem 0 0;
  color: var(--muted);
  font-size: 0.9em;
}

.conn {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--danger);
}

.conn.on {
  background: var(--accent);
}

.banner {
  margin: 0.25rem 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 0.9em;
}

.banner.warning {
  color: var(--warning);
}

.tabs {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 1rem;
  background: var(--bg);
}

.tabs button {
  flex: 1;
  padding: 0.6rem;
  border: none;
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  font-weight: 600;
}

.tabs button[aria-selected='true'] {
  background: var(--accent);
  color: var(--accent-text);
}

.badge {
  display: inline-block;
  min-width: 1.4em;
  padding: 0 0.35em;
  border-radius: 1em;
  background: var(--bg);
  color: var(--text);
  font-size: 0.8em;
}

.content {
  flex: 1;
  padding: 0.25rem 1rem 1rem;
}

.query {
  width: 100%;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--surface-2);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  font: inherit;
  font-size: max(16px, 1rem);
}

.chip {
  flex: none;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--surface-2);
  border-radius: 999px;
  background: none;
  cursor: pointer;
  white-space: nowrap;
}

.chip[aria-checked='true'] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.count {
  opacity: 0.6;
  font-size: 0.85em;
}

.total {
  margin: 0.4rem 0;
  color: var(--muted);
  font-size: 0.85em;
}

.footer {
  position: sticky;
  bottom: 0;
}

.toast {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  font-size: 0.9em;
  white-space: nowrap;
  max-width: calc(100vw - 2rem);
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
