import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  // Without this, importing any .svelte file fails at `</script>` with
  // "invalid JS syntax" and stores.svelte.ts throws "$state is not defined" —
  // so the UI layer was not merely untested, it was untestable.
  plugins: [svelte({ hot: false })],
  resolve: {
    // Svelte 5 ships separate client/server entries; without the browser
    // condition vitest resolves index-server.js, where `mount` throws
    // "lifecycle_function_unavailable". Test-only config, so this is safe.
    conditions: ['browser'],
    alias: {
      $core: resolve(__dirname, 'src/core'),
      $ui: resolve(__dirname, 'src/ui'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      // Was scoped to src/core, which reported ~96% while the project overall
      // sat near 32% — the tooling hid the untested half from itself.
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
})
