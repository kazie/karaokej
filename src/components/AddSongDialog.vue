<script setup lang="ts">
import { ref, watch } from 'vue'
import { songDetails } from '../format'
import { MAX_SINGER_LENGTH, type Song } from '../shared/protocol'

const props = defineProps<{ song: Song | null }>()
const emit = defineEmits<{ add: [singer: string, ball: boolean]; close: [] }>()

const SINGER_KEY = 'karaokej.singer'
const BALL_KEY = 'karaokej.ball'
const dialog = ref<HTMLDialogElement>()
const singer = ref(read(SINGER_KEY) ?? '')
/** The bouncing ball is on unless this singer turned it off before. */
const ball = ref(read(BALL_KEY) !== 'off')

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

watch(
  () => props.song,
  (song) => {
    if (song && !dialog.value?.open) dialog.value?.showModal()
    if (!song && dialog.value?.open) dialog.value.close()
  },
)

function add(): void {
  try {
    localStorage.setItem(SINGER_KEY, singer.value.trim())
    localStorage.setItem(BALL_KEY, ball.value ? 'on' : 'off')
  } catch {
    /* storage unavailable; the choices just aren't remembered */
  }
  emit('add', singer.value.trim(), ball.value)
}
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')" @click.self="dialog?.close()">
    <form v-if="song" method="dialog" @submit.prevent="add">
      <h2>{{ song.title }}</h2>
      <p class="meta">{{ songDetails(song) }}</p>
      <label>
        Who's singing? <span class="optional">(optional)</span>
        <input
          v-model="singer"
          type="text"
          :maxlength="MAX_SINGER_LENGTH"
          autocomplete="nickname"
          placeholder="Your name"
        />
      </label>
      <label class="switch">
        <input v-model="ball" type="checkbox" />
        Bouncing ball over the lyrics
      </label>
      <div class="actions">
        <button type="button" class="btn-secondary" @click="dialog?.close()">Cancel</button>
        <button type="submit" class="btn-primary">Add to queue</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(28rem, calc(100vw - 2rem));
  padding: 1.25rem;
  border: none;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}

.dialog::backdrop {
  background: rgb(0 0 0 / 0.6);
}

h2 {
  margin: 0;
  font-size: 1.2rem;
}

.meta {
  margin: 0.25rem 0 1rem;
  color: var(--muted);
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.optional {
  color: var(--muted);
  font-size: 0.85em;
}

input {
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--surface-2);
  border-radius: 0.5rem;
  background: var(--bg);
  color: inherit;
  font: inherit;
  font-size: max(16px, 1rem);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

label.switch {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.9rem;
  cursor: pointer;
}

.switch input {
  width: 1.2rem;
  height: 1.2rem;
  accent-color: var(--accent);
}
</style>
