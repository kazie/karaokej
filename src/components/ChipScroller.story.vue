<script setup lang="ts">
import { reactive } from 'vue'
import ChipScroller from './ChipScroller.vue'

const many = [
  'All',
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
]
const few = ['All', 'Pop', 'Rock']
const state = reactive({ many: 'All', few: 'All' })
</script>

<template>
  <Story title="Remote/ChipScroller" :layout="{ type: 'single', iframe: true }">
    <Variant title="Many categories (swipe or use ‹ ›)">
      <div class="phone">
        <ChipScroller label="Category">
          <button
            v-for="c in many"
            :key="c"
            type="button"
            role="radio"
            class="chip"
            :aria-checked="state.many === c"
            @click="state.many = c"
          >
            {{ c }}
          </button>
        </ChipScroller>
      </div>
    </Variant>
    <Variant title="Few categories (no buttons)">
      <div class="phone">
        <ChipScroller label="Category">
          <button
            v-for="c in few"
            :key="c"
            type="button"
            role="radio"
            class="chip"
            :aria-checked="state.few === c"
            @click="state.few = c"
          >
            {{ c }}
          </button>
        </ChipScroller>
      </div>
    </Variant>
  </Story>
</template>

<style scoped>
.phone {
  width: 390px;
  padding: 1rem;
  background: var(--bg);
}

.chip {
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
</style>
