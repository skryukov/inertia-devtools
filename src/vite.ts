import type { Plugin } from 'vite'
import type { DevToolsOptions } from './core/types'

// `router` is excluded: the plugin injects the app's own router instance into
// the generated init module — it cannot come from Vite config (not JSON).
export interface InertiaDevtoolsPluginOptions extends Omit<DevToolsOptions, 'router'> {
  /**
   * Replace devtools imports with a no-op module in production builds so zero
   * devtools bytes ship. Set to `false` to intentionally ship devtools
   * (pair with the runtime `enabled` option to control activation).
   * Default: `true`.
   */
  stripInProduction?: boolean
}

const INIT_ID = '\0inertia-devtools-init'
const NOOP_ID = '\0inertia-devtools-noop'

/**
 * Mirrors the package's value exports so stripped builds never break on
 * named imports left in app code (types are erased at compile time).
 */
const NOOP_MODULE = [
  'export function createInertiaDevtools() {}',
  'export function startCapture() { return () => {} }',
  'export class DevToolsStore {}',
].join('\n')

/**
 * Matches the module that *imports* `createInertiaApp` from an adapter, not
 * the adapter that declares and exports it. Testing for the bare identifier
 * also matched `@inertiajs/react`'s own dist, which the `node_modules` path
 * check misses whenever the adapter is workspace-linked or `npm link`ed — the
 * injected import then resolved from the adapter's directory and blew up.
 */
const IMPORTS_CREATE_INERTIA_APP = /import\s*\{[^}]*\bcreateInertiaApp\b[^}]*\}\s*from\s*['"]@inertiajs\/[^'"]+['"]/

/**
 * Vite 6+ routes transforms through named environments; older Vite passes
 * `{ ssr: true }` instead. Check both so the guard holds either way.
 */
function isSsrTransform(ctx: unknown, options: { ssr?: boolean } | undefined): boolean {
  if (options?.ssr) return true
  const env = (ctx as { environment?: { name?: string } } | undefined)?.environment
  return typeof env?.name === 'string' && env.name !== 'client'
}

/**
 * Vite plugin for inertia-devtools.
 * - In production builds: strips devtools by resolving the import to a no-op
 *   module, so `import 'inertia-devtools'` / `createInertiaDevtools()` can
 *   stay in app code permanently.
 * - In development: auto-injects devtools into the Inertia entrypoint and
 *   passes options.
 */
export function inertiaDevtools(options: InertiaDevtoolsPluginOptions = {}): Plugin {
  const { stripInProduction = true, ...runtimeOptions } = options
  let isDev = true
  let strip = false

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
      strip = stripInProduction && config.command === 'build' && !isDev
    },
    resolveId(source, importer) {
      if (source === 'inertia-devtools') {
        if (strip) {
          return NOOP_ID
        }
        // Intercept bare imports from user code (not from our virtual module)
        if (importer && !importer.startsWith('\0')) {
          return INIT_ID
        }
      }
      return null
    },
    load(id) {
      if (id === NOOP_ID) {
        return NOOP_MODULE
      }
      if (id === INIT_ID) {
        const optionsJson = JSON.stringify(runtimeOptions)
        // This module executes inside the APP's module graph, so it can import
        // the app's own router instance (the devtools bundle itself must never
        // import @inertiajs/core — peer dep, would double-bundle) and hand it
        // to the devtools for actions (replay/reload).
        return [
          `export { createInertiaDevtools } from 'inertia-devtools'`,
          `import { createInertiaDevtools as _init } from 'inertia-devtools'`,
          `import { router as __router } from '@inertiajs/core'`,
          `_init(Object.assign(${optionsJson}, { router: __router }))`,
        ].join('\n')
      }
      return null
    },
    transform(code, id, transformOptions) {
      if (!isDev) return
      if (id.includes('node_modules') || id.startsWith('\0')) return
      // Devtools need a DOM. Injecting into the server graph drags the whole
      // UI in for nothing, and resolution can fail outright when the importer
      // is a linked package outside the app's node_modules.
      if (isSsrTransform(this, transformOptions)) return

      // Auto-inject into EVERY module that sets up Inertia — init is
      // idempotent, and a single-claim slot broke multi-entry apps (whichever
      // entry transformed first stole the injection).
      if (IMPORTS_CREATE_INERTIA_APP.test(code)) {
        // Manual `import 'inertia-devtools'` already present — nothing to add
        if (code.includes('inertia-devtools')) return
        // Appended, not prepended: ESM import hoisting still runs it before
        // the module body, and original line numbers survive without needing
        // a sourcemap from this transform.
        return { code: `${code}\nimport 'inertia-devtools'\n`, map: null }
      }
    },
  }
}
