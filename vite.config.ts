import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        css: 'injected',
      },
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        entry: resolve(__dirname, 'src/entry.ts'),
        auto: resolve(__dirname, 'src/auto.ts'),
        vite: resolve(__dirname, 'src/vite.ts'),
      },
      formats: ['es'],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['@inertiajs/core'],
    },
    target: 'es2022',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      $core: resolve(__dirname, 'src/core'),
      $ui: resolve(__dirname, 'src/ui'),
      // Svelte's main entry registers its version in window.__svelte.v, which
      // triggers the "multiple Svelte versions" dev warning in Svelte host
      // apps; compilerOptions.discloseVersion only covers compiled components.
      'svelte/internal/disclose-version': resolve(__dirname, 'src/noop-module.ts'),
    },
  },
})
