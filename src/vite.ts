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
  'export function createInRealmClient() { return undefined }',
  'export class DevToolsStore {}',
].join('\n')

/**
 * Matches the module that *imports* `createInertiaApp` from an adapter, not
 * the adapter that declares and exports it. Testing for the bare identifier
 * also matched `@inertiajs/react`'s own dist, which the `node_modules` path
 * check misses whenever the adapter is workspace-linked or `npm link`ed — the
 * injected import then resolved from the adapter's directory and blew up.
 */
const IMPORTS_CREATE_INERTIA_APP = /import\s*\{[^}]*\bcreateInertiaApp\b[^}]*\}\s*from\s*['"](@inertiajs\/[^'"]+)['"]/

/**
 * First candidate the bundler can actually resolve, or undefined. A throwing
 * resolver counts as "not resolvable" — this runs inside the host app's build
 * and must never be the thing that fails it.
 */
async function firstResolvable(
  candidates: Array<string | undefined>,
  resolve: (source: string) => Promise<{ id: string } | null> | { id: string } | null,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      // Sequential on purpose: this is a preference order, not a race. Resolving
      // them in parallel would probe @inertiajs/core even when the adapter
      // already answered, which is the exact lookup that fails under pnpm.
      // eslint-disable-next-line no-await-in-loop
      if (await resolve(candidate)) return candidate
    } catch {
      /* treat as unresolvable and try the next */
    }
  }
  return undefined
}

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
  // Fail SAFE, not open. `configResolved` is a Vite-only hook, so a host that
  // consumes this through the plain Rollup interface never calls it and keeps
  // whatever these defaults say. They used to say "development": no stripping,
  // plus auto-injection — a production bundle that imports and boots the
  // devtools. An unknown host now gets the stripped behaviour and Vite flips
  // these to the truth in configResolved below.
  let isDev = false
  let strip = true
  /**
   * The adapter specifier the app imported `createInertiaApp` from, captured
   * during transform. Preferred over `@inertiajs/core` for the router import:
   * apps depend on the adapter, and every adapter re-exports `router`, so this
   * is the specifier guaranteed to resolve. `@inertiajs/core` is only reachable
   * when a flat `node_modules` hoists it — under pnpm, Yarn PnP, or any
   * isolated layout it is not, and hard-coding it broke the whole app.
   */
  let adapterSpecifier: string | undefined

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
      // Vitest resolves config with command: 'serve' and a non-SSR web
      // transform, so without this a consumer who adds the plugin gets the
      // full devtools booted inside every jsdom test: a #inertia-devtools-host
      // div in document.body breaking innerHTML snapshots, a pagehide listener
      // per test, and the UI chunk in the test runner. Vitest reads
      // vite.config.ts, so this is the default outcome, not an edge case.
      // Read off globalThis rather than a bare `process`: this package ships no
      // Node types, and unlike entry.ts's NODE_ENV gate nothing textually
      // replaces this — the plugin runs in Node, where the global really exists.
      const isTestRunner = Boolean(
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST,
      )
      isDev = config.command === 'serve' && !isTestRunner
      // Any build strips, whatever the mode. `--mode development` used to keep
      // devtools, which meant a QA/preview host built that way served a live,
      // mounting panel to every visitor — the plugin's own injected `_init()`
      // call bypasses the runtime NODE_ENV gate, so nothing else caught it.
      // Shipping devtools in a build is now one explicit opt-in, not an
      // implicit consequence of a flag chosen for unrelated reasons.
      // The test runner strips too: suppressing auto-injection is not enough,
      // since a manual `import 'inertia-devtools'` in app code under test would
      // otherwise still pull in and boot the real thing.
      strip = stripInProduction && (config.command === 'build' || isTestRunner)
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
    async load(id) {
      if (id === NOOP_ID) {
        return NOOP_MODULE
      }
      if (id === INIT_ID) {
        // Probe rather than assume: the adapter first (an app always depends on
        // it), then core for the manual-import path where no transform ran.
        const routerSpecifier = await firstResolvable([adapterSpecifier, '@inertiajs/core'], (source) =>
          this.resolve(source),
        )
        const optionsJson = JSON.stringify(runtimeOptions)
        // This module executes inside the APP's module graph, so it can import
        // the app's own router instance (the devtools bundle itself must never
        // import @inertiajs/core — peer dep, would double-bundle) and hand it
        // to the devtools for actions (replay/reload).
        const lines = [
          `export { createInertiaDevtools } from 'inertia-devtools'`,
          `import { createInertiaDevtools as _init } from 'inertia-devtools'`,
        ]
        if (routerSpecifier) {
          lines.push(
            `import { router as __router } from '${routerSpecifier}'`,
            `_init(Object.assign(${optionsJson}, { router: __router }))`,
          )
        } else {
          // Nothing resolvable to import the router from. Devtools still work;
          // only replay/reload go dark. Failing the build here would mean the
          // plugin bricks the app it is meant to observe.
          lines.push(`_init(${optionsJson})`)
        }
        return lines.join('\n')
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
      const match = IMPORTS_CREATE_INERTIA_APP.exec(code)
      if (match) {
        // Remember which adapter this app uses so the init module imports the
        // router from a specifier that is actually resolvable for it.
        adapterSpecifier ??= match[1]
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
