import { describe, it, expect } from 'vitest'

// No Node types in this package — the plugin (and these tests) run in Node.
declare const process: { env: Record<string, string | undefined> }
// Vite's ?raw loader — avoids depending on @types/node just to read a file.
// oxlint-disable-next-line import/default -- the loader supplies the default export
import indexSource from './index.ts?raw'
import { inertiaDevtools, type InertiaDevtoolsPluginOptions } from './vite'

const INIT_ID = '\0inertia-devtools-init'
const NOOP_ID = '\0inertia-devtools-noop'

interface PluginHooks {
  configResolved(config: { command: 'serve' | 'build'; mode: string }): void
  resolveId(source: string, importer?: string): string | null
  load(id: string): Promise<string | null> | string | null
  transform(code: string, id: string, options?: { ssr?: boolean }): { code: string; map: null } | undefined
}

type TransformResult = { code: string; map: null } | undefined

/**
 * Drive the async `load` hook with a controllable resolver, standing in for
 * Rollup's `this.resolve`. `resolvable` lists the specifiers this fake project
 * layout can resolve — the default is a flat `node_modules` where everything
 * is reachable.
 */
function loadIn(
  plugin: PluginHooks,
  id: string,
  resolvable: string[] = ['@inertiajs/core', '@inertiajs/react', '@inertiajs/svelte', '@inertiajs/vue3'],
): Promise<string | null> {
  const ctx = { resolve: (source: string) => (resolvable.includes(source) ? { id: source } : null) }
  return Promise.resolve((plugin.load as (this: unknown, i: string) => Promise<string | null>).call(ctx, id))
}

/** Call transform with a Vite plugin context (environment-aware transforms). */
function transformIn(
  plugin: PluginHooks,
  ctx: { environment?: { name: string } },
  code: string,
  id: string,
): TransformResult {
  return (plugin.transform as (this: unknown, c: string, i: string) => TransformResult).call(ctx, code, id)
}

/**
 * Build the plugin and run configResolved — hooks don't use plugin context.
 *
 * These tests themselves run under Vitest, and the plugin now strips when it
 * detects a test runner (so a consumer's component tests don't boot the panel).
 * The helper therefore clears VITEST while resolving config, so each test
 * describes the host it means — a real dev server or a real build. The one
 * test that exercises the guard sets the variable itself.
 */
function makePlugin(
  config: { command: 'serve' | 'build'; mode: string },
  options: InertiaDevtoolsPluginOptions = {},
): PluginHooks {
  const plugin = inertiaDevtools(options) as unknown as PluginHooks
  const previous = process.env.VITEST
  Reflect.deleteProperty(process.env, 'VITEST')
  try {
    plugin.configResolved(config)
  } finally {
    if (previous !== undefined) process.env.VITEST = previous
  }
  return plugin
}

const devServer = { command: 'serve', mode: 'development' } as const
const prodBuild = { command: 'build', mode: 'production' } as const

describe('inertiaDevtools vite plugin', () => {
  describe('dev server', () => {
    it('resolves user imports to the init module', () => {
      const plugin = makePlugin(devServer)
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
    })

    it('lets imports from the virtual init module reach the real package', () => {
      const plugin = makePlugin(devServer)
      expect(plugin.resolveId('inertia-devtools', INIT_ID)).toBe(null)
      expect(plugin.resolveId('inertia-devtools')).toBe(null)
    })

    it('ignores unrelated modules', async () => {
      const plugin = makePlugin(devServer)
      expect(plugin.resolveId('svelte', '/src/app.ts')).toBe(null)
      expect(await loadIn(plugin, '/src/app.ts')).toBe(null)
    })

    it('serves an init module that forwards options to createInertiaDevtools', async () => {
      const plugin = makePlugin(devServer, { docsProvider: 'inertia-rails' })
      const code = await loadIn(plugin, INIT_ID)
      expect(code).toContain(`export { createInertiaDevtools } from 'inertia-devtools'`)
      expect(code).toContain(`_init(Object.assign({"docsProvider":"inertia-rails"}, { router: __router }))`)
    })

    it('imports the app router and passes it to the init options', async () => {
      const plugin = makePlugin(devServer)
      const code = await loadIn(plugin, INIT_ID)
      expect(code).toContain(`import { router as __router } from '@inertiajs/core'`)
      expect(code).toContain(`_init(Object.assign({}, { router: __router }))`)
    })

    it('imports the router from the adapter the app actually uses', async () => {
      // An app depends on its adapter, not on @inertiajs/core. Under pnpm /
      // Yarn PnP / any isolated layout, core is unreachable from the project
      // root — hard-coding it made the init module unresolvable, which took
      // the whole app down with a 500.
      const plugin = makePlugin(devServer)
      plugin.transform(`import { createInertiaApp } from '@inertiajs/react'`, '/src/app.tsx')
      const code = await loadIn(plugin, INIT_ID, ['@inertiajs/react'])
      expect(code).toContain(`import { router as __router } from '@inertiajs/react'`)
      expect(code).toContain(`_init(Object.assign({}, { router: __router }))`)
    })

    it('falls back to @inertiajs/core when no adapter was seen', async () => {
      // Manual `import 'inertia-devtools'` with no transform to learn from.
      const plugin = makePlugin(devServer)
      const code = await loadIn(plugin, INIT_ID, ['@inertiajs/core'])
      expect(code).toContain(`import { router as __router } from '@inertiajs/core'`)
    })

    it('omits the router rather than emitting an unresolvable import', async () => {
      // Nothing resolvable: devtools still load, only replay/reload go dark.
      // The old behaviour emitted the import anyway and broke the app.
      const plugin = makePlugin(devServer)
      const code = await loadIn(plugin, INIT_ID, [])
      expect(code).not.toContain('__router')
      expect(code).toContain('_init({})')
      expect(code).toContain(`export { createInertiaDevtools } from 'inertia-devtools'`)
    })

    it('treats a throwing resolver as unresolvable instead of failing the build', async () => {
      const plugin = makePlugin(devServer)
      const ctx = {
        resolve: () => {
          throw new Error('resolver exploded')
        },
      }
      const load = plugin.load as (this: unknown, i: string) => Promise<string | null>
      const code = await load.call(ctx, INIT_ID)
      expect(code).toContain('_init({})')
    })

    it('appends the devtools import so original line numbers survive', () => {
      const plugin = makePlugin(devServer)
      const code = `import { createInertiaApp } from '@inertiajs/svelte'`
      const result = plugin.transform(code, '/src/app.ts')
      expect(result).toEqual({ code: `${code}\nimport 'inertia-devtools'\n`, map: null })
      expect(result!.code.startsWith(code)).toBe(true)
    })

    it('injects into every createInertiaApp module (client + SSR dual entries)', () => {
      const plugin = makePlugin(devServer)
      const code = `import { createInertiaApp } from '@inertiajs/svelte'`
      // SSR entry transforming first must not steal the client's injection
      expect(plugin.transform(code, '/src/ssr.ts')).not.toBe(undefined)
      expect(plugin.transform(code, '/src/app.ts')).not.toBe(undefined)
    })

    it('re-injects when Vite re-transforms the entry (invalidation survives)', () => {
      const plugin = makePlugin(devServer)
      const code = `import { createInertiaApp } from '@inertiajs/svelte'`
      expect(plugin.transform(code, '/src/app.ts')).not.toBe(undefined)
      // Dep-optimizer reload / file edit re-runs transform on the same id
      expect(plugin.transform(code, '/src/app.ts')).not.toBe(undefined)
    })

    it('does not duplicate a manual inertia-devtools import', () => {
      const plugin = makePlugin(devServer)
      const code = `import 'inertia-devtools'\nimport { createInertiaApp } from '@inertiajs/svelte'`
      expect(plugin.transform(code, '/src/app.ts')).toBe(undefined)
    })

    it('does not inject into node_modules or virtual modules', () => {
      const plugin = makePlugin(devServer)
      const code = `import { createInertiaApp } from '@inertiajs/svelte'`
      expect(plugin.transform(code, '/node_modules/@inertiajs/svelte/index.js')).toBe(undefined)
      expect(plugin.transform(code, INIT_ID)).toBe(undefined)
    })

    it('does not inject into the adapter that declares createInertiaApp', () => {
      const plugin = makePlugin(devServer)
      // pnpm workspaces and `npm link` resolve adapters to real paths outside
      // node_modules, so the path guard alone does not save us here.
      const adapterDist = [
        'async function createInertiaApp({ id, resolve, setup }) {}',
        'export { createInertiaApp, router }',
      ].join('\n')
      expect(plugin.transform(adapterDist, '/workspace/packages/react/dist/index.js')).toBe(undefined)
    })

    it('injects on a multi-line adapter import', () => {
      const plugin = makePlugin(devServer)
      const code = `import {\n  createInertiaApp,\n  router,\n} from '@inertiajs/vue3'`
      expect(plugin.transform(code, '/src/app.ts')).not.toBe(undefined)
    })

    it('does not inject into the SSR graph', () => {
      const plugin = makePlugin(devServer)
      const code = `import { createInertiaApp } from '@inertiajs/react'`
      // Vite 6+ named environments…
      expect(transformIn(plugin, { environment: { name: 'ssr' } }, code, '/src/app.tsx')).toBe(undefined)
      // …and the older `{ ssr: true }` flag.
      expect(plugin.transform(code, '/src/app.tsx', { ssr: true })).toBe(undefined)
      // The client environment still gets it.
      expect(transformIn(plugin, { environment: { name: 'client' } }, code, '/src/app.tsx')).not.toBe(undefined)
    })
  })

  describe('production build', () => {
    it('resolves every devtools import to the no-op module', () => {
      const plugin = makePlugin(prodBuild)
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(NOOP_ID)
      expect(plugin.resolveId('inertia-devtools')).toBe(NOOP_ID)
    })

    it('stubs every value export declared in index.ts (derived, cannot drift)', async () => {
      // The old version of this test hardcoded the same three names as the
      // implementation, so it asserted the code against itself and missed
      // `createInRealmClient` — which failed real production builds. Read the
      // public surface from source instead.
      const index = indexSource
      const exported = [...index.matchAll(/^export \{ ([^}]+) \} from/gm)].flatMap((m) =>
        m[1].split(',').map(
          (n: string) =>
            n
              .trim()
              .split(/\s+as\s+/)
              .pop()!,
        ),
      )
      expect(exported.length).toBeGreaterThan(0)

      const code = (await loadIn(makePlugin(prodBuild), NOOP_ID))!
      for (const name of exported) {
        expect(code, `no-op module is missing a stub for "${name}"`).toMatch(
          new RegExp(`export (?:function|class|const) ${name}\\b`),
        )
      }
    })

    it('serves a no-op module with stubs for every public value export', async () => {
      const plugin = makePlugin(prodBuild)
      const code = await loadIn(plugin, NOOP_ID)
      expect(code).toContain('export function createInertiaDevtools() {}')
      expect(code).toContain('export function startCapture()')
      expect(code).toContain('export function createInRealmClient()')
      expect(code).toContain('export class DevToolsStore {}')
    })

    it('does not inject the devtools import', () => {
      const plugin = makePlugin(prodBuild)
      const code = `import { createInertiaApp } from '@inertiajs/svelte'`
      expect(plugin.transform(code, '/src/app.ts')).toBe(undefined)
    })

    it('strips non-development modes too (e.g. --mode staging)', () => {
      const plugin = makePlugin({ command: 'build', mode: 'staging' })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(NOOP_ID)
    })
  })

  describe('command/mode semantics', () => {
    it('strips `vite build --mode development` too — a build is a build', () => {
      // Regression: this used to return INIT_ID, so a preview/QA host built
      // with --mode development served a live, mounting devtools panel. The
      // injected _init() call bypasses the runtime NODE_ENV gate, so stripping
      // is the only thing standing between that flag and a public panel.
      const plugin = makePlugin({ command: 'build', mode: 'development' })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(NOOP_ID)
    })

    it('injects on the dev server whatever the mode', () => {
      // `vite --mode staging` is still a dev server; devtools must appear.
      const plugin = makePlugin({ command: 'serve', mode: 'staging' })
      const code = `import { createInertiaApp } from '@inertiajs/react'`
      expect(plugin.transform(code, '/src/app.tsx')).not.toBe(undefined)
    })

    it('never strips on the dev server, whatever the mode', () => {
      const plugin = makePlugin({ command: 'serve', mode: 'production' })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
    })
  })

  describe('unknown host / test runner (fail safe)', () => {
    it('strips when configResolved never runs — a non-Vite Rollup host', () => {
      // configResolved is Vite-only. A plain Rollup consumer never calls it, so
      // the plugin keeps its defaults. Those used to mean "development": no
      // strip plus auto-injection, i.e. a production bundle booting devtools.
      const plugin = inertiaDevtools() as unknown as PluginHooks
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(NOOP_ID)
    })

    it('does not auto-inject when configResolved never runs', () => {
      const plugin = inertiaDevtools() as unknown as PluginHooks
      const code = `import { createInertiaApp } from '@inertiajs/react'`
      expect(plugin.transform(code, '/src/app.tsx')).toBe(undefined)
    })

    it('strips under Vitest even though the command is serve', () => {
      // Vitest resolves config with command: 'serve', so without a guard every
      // jsdom test boots the panel into document.body.
      const previous = process.env.VITEST
      process.env.VITEST = 'true'
      try {
        const plugin = inertiaDevtools() as unknown as PluginHooks
        plugin.configResolved(devServer)
        expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(NOOP_ID)
        const code = `import { createInertiaApp } from '@inertiajs/react'`
        expect(plugin.transform(code, '/src/app.tsx')).toBe(undefined)
      } finally {
        if (previous === undefined) Reflect.deleteProperty(process.env, 'VITEST')
        else process.env.VITEST = previous
      }
    })
  })

  describe('stripInProduction: false', () => {
    it('keeps devtools in production builds', async () => {
      const plugin = makePlugin(prodBuild, { stripInProduction: false })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
      expect(await loadIn(plugin, INIT_ID)).toContain(`export { createInertiaDevtools } from 'inertia-devtools'`)
    })

    it('omits stripInProduction from the runtime options', async () => {
      const plugin = makePlugin(prodBuild, { stripInProduction: false, docsProvider: 'inertiajs' })
      const code = await loadIn(plugin, INIT_ID)
      expect(code).toContain(`_init(Object.assign({"docsProvider":"inertiajs"}, { router: __router }))`)
      expect(code).not.toContain('stripInProduction')
    })

    it('also AUTO-INJECTS in a production build, not just on the manual-import path', () => {
      // The option worked when app code had `import 'inertia-devtools'` and
      // silently did nothing without it, because transform() was gated on a
      // separate isDev flag that no build ever sets. That is the path the
      // README's Quick Start recommends, so the documented setup shipped an
      // empty bundle while the config said devtools were kept.
      const plugin = makePlugin(prodBuild, { stripInProduction: false })
      const result = plugin.transform(`import { createInertiaApp } from '@inertiajs/vue3'`, '/src/app.ts')
      expect(result).not.toBe(undefined)
      expect((result as { code: string }).code).toContain(`import 'inertia-devtools'`)
    })

    it('still injects nothing in a stripping build', () => {
      const plugin = makePlugin(prodBuild, { stripInProduction: true })
      expect(plugin.transform(`import { createInertiaApp } from '@inertiajs/vue3'`, '/src/app.ts')).toBe(undefined)
    })
  })
})
