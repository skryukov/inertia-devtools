import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Don't register our bundled Svelte in window.__svelte.v — it triggers
    // the "multiple Svelte versions" dev warning in Svelte host apps.
    discloseVersion: false,
  },
}
