import { describe, it, expect } from 'vitest'
import { inertiaDevtools, type InertiaDevtoolsPluginOptions } from './vite'

const INIT_ID = '\0inertia-devtools-init'
const NOOP_ID = '\0inertia-devtools-noop'

interface PluginHooks {
  configResolved(config: { command: 'serve' | 'build'; mode: string }): void
  resolveId(source: string, importer?: string): string | null
  load(id: string): string | null
  transform(code: string, id: string, options?: { ssr?: boolean }): { code: string; map: null } | undefined
}

type TransformResult = { code: string; map: null } | undefined

/** Call transform with a Vite plugin context (environment-aware transforms). */
function transformIn(
  plugin: PluginHooks,
  ctx: { environment?: { name: string } },
  code: string,
  id: string,
): TransformResult {
  return (plugin.transform as (this: unknown, c: string, i: string) => TransformResult).call(ctx, code, id)
}

/** Build the plugin and run configResolved — hooks don't use plugin context. */
function makePlugin(
  config: { command: 'serve' | 'build'; mode: string },
  options: InertiaDevtoolsPluginOptions = {},
): PluginHooks {
  const plugin = inertiaDevtools(options) as unknown as PluginHooks
  plugin.configResolved(config)
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

    it('ignores unrelated modules', () => {
      const plugin = makePlugin(devServer)
      expect(plugin.resolveId('svelte', '/src/app.ts')).toBe(null)
      expect(plugin.load('/src/app.ts')).toBe(null)
    })

    it('serves an init module that forwards options to createInertiaDevtools', () => {
      const plugin = makePlugin(devServer, { docsProvider: 'inertia-rails' })
      const code = plugin.load(INIT_ID)
      expect(code).toContain(`export { createInertiaDevtools } from 'inertia-devtools'`)
      expect(code).toContain(`_init(Object.assign({"docsProvider":"inertia-rails"}, { router: __router }))`)
    })

    it('imports the app router and passes it to the init options', () => {
      const plugin = makePlugin(devServer)
      const code = plugin.load(INIT_ID)
      expect(code).toContain(`import { router as __router } from '@inertiajs/core'`)
      expect(code).toContain(`_init(Object.assign({}, { router: __router }))`)
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

    it('serves a no-op module with stubs for every public value export', () => {
      const plugin = makePlugin(prodBuild)
      const code = plugin.load(NOOP_ID)
      expect(code).toContain('export function createInertiaDevtools() {}')
      expect(code).toContain('export function startCapture()')
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
    it('keeps devtools in `vite build --mode development`', () => {
      const plugin = makePlugin({ command: 'build', mode: 'development' })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
    })

    it('never strips on the dev server, whatever the mode', () => {
      const plugin = makePlugin({ command: 'serve', mode: 'production' })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
    })
  })

  describe('stripInProduction: false', () => {
    it('keeps devtools in production builds', () => {
      const plugin = makePlugin(prodBuild, { stripInProduction: false })
      expect(plugin.resolveId('inertia-devtools', '/src/app.ts')).toBe(INIT_ID)
      expect(plugin.load(INIT_ID)).toContain(`export { createInertiaDevtools } from 'inertia-devtools'`)
    })

    it('omits stripInProduction from the runtime options', () => {
      const plugin = makePlugin(prodBuild, { stripInProduction: false, docsProvider: 'inertiajs' })
      const code = plugin.load(INIT_ID)
      expect(code).toContain(`_init(Object.assign({"docsProvider":"inertiajs"}, { router: __router }))`)
      expect(code).not.toContain('stripInProduction')
    })
  })
})
