<script setup lang="ts">
import { computed } from 'vue'
import { encode } from 'uqr'

const props = defineProps<{ value: string; label?: string }>()

/** One SVG path with a 1×1 square per dark module; crisp at any size. */
const qr = computed(() => {
  const { size, data } = encode(props.value, { ecc: 'M', border: 2 })
  let d = ''
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return { size, d }
})
</script>

<template>
  <svg
    class="qr"
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    role="img"
    :aria-label="label ?? `QR code for ${value}`"
    shape-rendering="crispEdges"
  >
    <rect :width="qr.size" :height="qr.size" fill="#fff" />
    <path :d="qr.d" fill="#000" />
  </svg>
</template>

<style scoped>
.qr {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 0.5rem;
}
</style>
