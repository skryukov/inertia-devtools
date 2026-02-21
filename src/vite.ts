import type { Plugin } from 'vite'
import type { DevToolsOptions } from './core/types'

/**
 * Vite plugin for inertia-devtools.
 * - In production: strips devtools by resolving the import to an empty module.
 * - In development: auto-injects devtools into the Inertia entrypoint and passes options.
 */
export function inertiaDevtools(options: DevToolsOptions = {}): Plugin {
  let isDev = true
  let injected = false

  return {
    name: 'inertia-devtools',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          exclude: ['inertia-devtools'],
        },
      }
    },
    configResolved(config) {
      isDev = config.mode === 'development'
    },
    resolveId(source, importer) {
      if (source === 'inertia-devtools') {
        if (!isDev) {
          return '\0inertia-devtools-noop'
        }
        // Intercept bare imports from user code (not from our virtual module)
        if (importer && !importer.startsWith('\0')) {
          return '\0inertia-devtools-init'
        }
      }
      return null
    },
    load(id) {
      if (id === '\0inertia-devtools-noop') {
        return 'export {}'
      }
      if (id === '\0inertia-devtools-init') {
        const optionsJson = JSON.stringify(options)
        return [
          `export { createInertiaDevtools } from 'inertia-devtools'`,
          `import { createInertiaDevtools as _init } from 'inertia-devtools'`,
          `_init(${optionsJson})`,
        ].join('\n')
      }
      return null
    },
    transform(code, id) {
      if (!isDev || injected) return
      if (id.includes('node_modules') || id.startsWith('\0')) return

      // Auto-inject into the file that imports createInertiaApp
      if (/\bcreateInertiaApp\b/.test(code)) {
        injected = true
        return `import 'inertia-devtools'\n${code}`
      }
    },
  }
}
