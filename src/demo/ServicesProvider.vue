<script setup lang="ts">
import { provideServices, type KaraokeServices } from '../services'

/** Stories wrap views in this to swap the real server for a fake backend. */
const props = defineProps<{ services: KaraokeServices }>()
provideServices(props.services)
</script>

<template>
  <slot />
</template>
