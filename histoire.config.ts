import { defineConfig } from 'histoire'
import { HstVue } from '@histoire/plugin-vue'
import { histoireOffline } from './histoire.offline'

export default defineConfig({
  plugins: [HstVue()],
  setupFile: './src/histoire.setup.ts',
  vite: { plugins: [histoireOffline()] },
  theme: {
    title: 'Karaokej',
  },
})
