import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backend = `http://127.0.0.1:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [vue()],
  server: {
    // Listen on the LAN so phones can reach the dev server.
    host: true,
    proxy: {
      '/api': backend,
      '/ws': { target: backend, ws: true },
    },
  },
})
