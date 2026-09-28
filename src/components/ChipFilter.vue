<script setup lang="ts">
import ChipScroller from './ChipScroller.vue'

/**
 * A row of radio chips: "All", then one chip per option with its count. The
 * model is the chosen option's value, or `null` for "All"; an empty value is
 * shown as "Other". Other attributes (e.g. `prev-label`) go to the ChipScroller.
 */
defineProps<{
  label: string
  options: readonly { value: string; count: number }[]
  /** Smaller chips, for a row that narrows down another one. */
  compact?: boolean
}>()

const model = defineModel<string | null>({ required: true })
</script>

<template>
  <ChipScroller :label="label" :class="{ compact }">
    <button type="button" role="radio" class="chip" :aria-checked="model === null" @click="model = null">
      All
    </button>
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      class="chip"
      :aria-checked="model === o.value"
      @click="model = o.value"
    >
      {{ o.value || 'Other' }} <span class="count">{{ o.count }}</span>
    </button>
  </ChipScroller>
</template>

<style scoped>
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

.compact .chip {
  padding: 0.3rem 0.65rem;
  font-size: 0.9em;
}
</style>
