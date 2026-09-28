<script setup lang="ts">
import { reactive } from 'vue'
import ChipFilter from './ChipFilter.vue'

const many = [
  'Anime',
  'Animerat',
  'Doujin',
  'Hypnosis Mic',
  'Jul',
  'Live Action',
  'Musikaler',
  'Nya Låtar',
  'Original',
  'Spel',
  'Vocaloid',
  'Övrigt',
].map((value, i) => ({ value, count: 10 + i }))
const few = ['Pop', 'Rock'].map((value) => ({ value, count: 20 }))
/** Folders per category for the two-row variant; `''` is songs directly in the category ("Other"). */
const folders: Record<string, { value: string; count: number }[]> = {
  Anime: [
    { value: '', count: 3 },
    { value: 'Ghibli', count: 5 },
    { value: 'Movies', count: 2 },
    { value: 'Shows', count: 4 },
  ],
  Spel: [
    { value: '', count: 1 },
    { value: 'Nintendo', count: 6 },
    { value: 'PlayStation', count: 3 },
  ],
}
const state = reactive({
  many: null as string | null,
  few: null as string | null,
  category: 'Anime' as string | null,
  folder: null as string | null,
})

function pickCategory(c: string | null): void {
  state.category = c
  state.folder = null
}
</script>

<template>
  <Story title="Remote/ChipScroller" :layout="{ type: 'single', iframe: true }">
    <Variant title="Many categories (swipe or use ‹ ›)">
      <div class="phone">
        <ChipFilter v-model="state.many" label="Category" :options="many" />
      </div>
    </Variant>
    <Variant title="Few categories (no buttons)">
      <div class="phone">
        <ChipFilter v-model="state.few" label="Category" :options="few" />
      </div>
    </Variant>
    <Variant title="Two rows: category, then its folders (ChipFilter)">
      <div class="phone">
        <ChipFilter
          :model-value="state.category"
          label="Category"
          :options="many"
          @update:model-value="pickCategory"
        />
        <ChipFilter
          v-if="state.category && folders[state.category]"
          v-model="state.folder"
          class="subfolders"
          compact
          :label="`Folders in ${state.category}`"
          :options="folders[state.category]!"
        />
      </div>
      <template #controls>
        <p class="note">
          As on the remote phone: Anime and Spel have folders; other categories show one row only.
        </p>
      </template>
    </Variant>
  </Story>
</template>

<style scoped>
.phone {
  width: 390px;
  padding: 1rem;
  background: var(--bg);
}

/* As on the remote phone: the folder row sits close under the category row. */
.subfolders {
  margin-top: -0.35rem;
}

.note {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  opacity: 0.8;
}
</style>
