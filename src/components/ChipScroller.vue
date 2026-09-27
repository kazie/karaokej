<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * A horizontal row that scrolls by swiping, with subtle < and > buttons for
 * people who don't swipe. Each button only shows when there is more that way.
 */
withDefaults(defineProps<{ label: string; prevLabel?: string; nextLabel?: string }>(), {
  prevLabel: 'Scroll left',
  nextLabel: 'Scroll right',
})

const row = ref<HTMLElement>()
const canPrev = ref(false)
const canNext = ref(false)

function update(): void {
  const el = row.value
  if (!el) return
  canPrev.value = el.scrollLeft > 1
  canNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function page(direction: -1 | 1): void {
  const el = row.value
  if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
}

/** Keep the selected chip (`aria-checked="true"`) visible, e.g. after choosing one off screen. */
function revealSelected(): void {
  row.value
    ?.querySelector('[aria-checked="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
onMounted(() => {
  const el = row.value!
  // Fires once right away, then on size changes.
  resizeObserver = new ResizeObserver(update)
  resizeObserver.observe(el)
  // Chips arrive asynchronously (categories load after mount), and the selection changes.
  mutationObserver = new MutationObserver((records) => {
    update()
    if (records.some((r) => r.attributeName === 'aria-checked')) revealSelected()
  })
  mutationObserver.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-checked'],
  })
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
})
</script>

<template>
  <div class="scroller" :class="{ 'can-prev': canPrev, 'can-next': canNext }">
    <div ref="row" class="row" role="radiogroup" :aria-label="label" @scroll.passive="update">
      <slot />
    </div>
    <button v-show="canPrev" type="button" class="nav prev" :aria-label="prevLabel" @click="page(-1)">
      ‹
    </button>
    <button v-show="canNext" type="button" class="nav next" :aria-label="nextLabel" @click="page(1)">
      ›
    </button>
  </div>
</template>

<style scoped>
.scroller {
  position: relative;
}

.row {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding: 0.6rem 0 0.2rem;
  scroll-snap-type: x proximity;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.row::-webkit-scrollbar {
  display: none;
}

.row > :deep(*) {
  flex: none;
  scroll-snap-align: start;
}

/* Soft fades hint that more chips are hidden that way. */
.scroller::before,
.scroller::after {
  content: '';
  position: absolute;
  top: 0.6rem;
  bottom: 0.2rem;
  width: 2.5rem;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
}

.scroller::before {
  left: 0;
  background: linear-gradient(to right, var(--bg), transparent);
}

.scroller::after {
  right: 0;
  background: linear-gradient(to left, var(--bg), transparent);
}

.can-prev::before,
.can-next::after {
  opacity: 1;
}

.nav {
  position: absolute;
  top: calc(50% + 0.2rem);
  z-index: 1;
  width: 1.8rem;
  height: 1.8rem;
  padding: 0;
  border: 1px solid var(--surface-2);
  border-radius: 50%;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--muted);
  font-size: 1.2rem;
  line-height: 1;
  transform: translateY(-50%);
  cursor: pointer;
}

.nav:hover,
.nav:focus-visible {
  color: var(--text);
  border-color: var(--muted);
}

.prev {
  left: 0;
}

.next {
  right: 0;
}
</style>
