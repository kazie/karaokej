import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'server/index.ts' },
  outDir: 'dist-server',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  clean: true,
  // Keep npm dependencies external; they are installed in the runtime image.
  deps: { neverBundle: [/^[^./]/] },
})
