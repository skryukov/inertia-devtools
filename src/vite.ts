import type { Plugin } from 'vite'
import type { DevToolsOptions } from './core/types'
import { existsSync } from 'node:fs'
// aliased: the plugin already has a `resolve` parameter in firstResolvable.
import { resolve as resolvePath, sep } from 'node:path'
import { spawn } from 'node:child_process'

// `router` is excluded: the plugin injects the app's own router instance into
// the generated init module — it cannot come from Vite config (not JSON).
export interface InertiaDevtoolsPluginOptions extends Omit<DevToolsOptions, 'router' | 'sourceLinks'> {
  /**
   * Replace devtools imports with a no-op module in production builds so zero
   * devtools bytes ship. Set to `false` to intentionally ship devtools
   * (pair with the runtime `enabled` option to control activation).
   * Default: `true`.
   */
  stripInProduction?: boolean
  /**
   * Make component names in the panel clickable, opening their source file in
   * your editor. The plugin mounts a dev-server endpoint that maps a component
   * name to a file under the pages directory and launches the editor ($EDITOR,
   * or $INERTIA_DEVTOOLS_EDITOR).
   *
   * With no `pagesDir`, the plugin auto-detects the first common Inertia layout
   * that exists (Vite `src/pages`, Laravel `resources/js/Pages`, Inertia Rails
   * `app/frontend/pages`, …) so the feature works outside the Vite-default
   * layout instead of silently disabling. Set `pagesDir` to pin one exactly.
   *
   * Resolution is contained to the pages directory (a `../` component name is
   * rejected), and the feature auto-disables when no directory exists so links
   * never dangle. Dev-only — never mounted in a build. Pass `false` to disable.
   */
  sourceLinks?: boolean | { pagesDir?: string; extensions?: string[] }
}

/**
 * Probed in order when no explicit `pagesDir` is given; the first that exists
 * wins. Covers the layouts the official adapters ship: Vite starters, Laravel,
 * and the Inertia Rails generator. An explicit `pagesDir` skips this entirely.
 */
const DEFAULT_PAGES_DIRS = [
  'src/pages', // Vite / React & Vue starters, Inertia's own default
  'resources/js/Pages', // Laravel convention (capitalised)
  'resources/js/pages',
  'app/frontend/pages', // current Inertia Rails generator
  'app/javascript/pages', // older Inertia Rails
]
const DEFAULT_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte']
const OPEN_ENDPOINT = '/__inertia-devtools/open'

interface SourceLinksConfig {
  enabled: boolean
  /** Explicit pages dir, or null to auto-detect from DEFAULT_PAGES_DIRS. */
  pagesDir: string | null
  extensions: string[]
}

function normalizeSourceLinks(option: InertiaDevtoolsPluginOptions['sourceLinks']): SourceLinksConfig {
  if (option === false) {
    return { enabled: false, pagesDir: null, extensions: DEFAULT_EXTENSIONS }
  }
  const object = option && typeof option === 'object' ? option : {}
  return {
    enabled: true,
    pagesDir: object.pagesDir ?? null,
    extensions: object.extensions ?? DEFAULT_EXTENSIONS,
  }
}

/**
 * Absolute pages directory: the explicit `pagesDir` if set (resolved even when
 * absent, so the existsSync gate in configResolved disables the feature), else
 * the first auto-detected layout that exists. Falls back to the canonical
 * default when none match — that path won't exist either, so the feature stays
 * off rather than dangling.
 */
function resolvePagesDir(root: string, explicit: string | null): string {
  if (explicit) return resolvePath(root, explicit)
  for (const dir of DEFAULT_PAGES_DIRS) {
    const absolute = resolvePath(root, dir)
    if (existsSync(absolute)) return absolute
  }
  return resolvePath(root, DEFAULT_PAGES_DIRS[0])
}

/**
 * True when a request's `Origin` matches the dev server it hit. Browsers attach
 * a truthful, JS-unsettable `Origin` to every cross-site request, so this is
 * what stops a page on evil.com from blind-firing the editor endpoint at a local
 * Vite server. A missing Origin (curl, some same-origin GETs) is allowed — the
 * POST-only guard already blocks the drive-by `<img>`/top-level-GET vector.
 */
export function isSameOriginRequest(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Resolve an Inertia component name to a source file inside `pagesDirAbs`, or
 * null. CONTAINMENT-GUARDED: a name like `../../secret` resolves outside the
 * pages directory and is rejected before any filesystem access, so the browser
 * can only ever ask the dev server to open files beneath the configured pages
 * root — never an arbitrary path. Exported so the guard is unit-tested directly.
 */
export function resolveComponentSource(pagesDirAbs: string, extensions: string[], component: string): string | null {
  if (!component) return null
  const boundary = pagesDirAbs.endsWith(sep) ? pagesDirAbs : pagesDirAbs + sep
  for (const extension of extensions) {
    const candidate = resolvePath(pagesDirAbs, component + extension)
    // Reject anything that escaped pagesDir (path traversal) before touching fs.
    if (!candidate.startsWith(boundary)) continue
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Best-effort open in the user's editor — zero-dependency by design. Honours
 * $INERTIA_DEVTOOLS_EDITOR, then $EDITOR, defaulting to `code`, and uses the
 * VS Code-family `-g file:line` form when the editor looks like one. A missing
 * editor is swallowed: the endpoint still reports the resolved path.
 */
function openInEditor(file: string, line = 1): void {
  const spec = process.env.INERTIA_DEVTOOLS_EDITOR || process.env.EDITOR || 'code'
  const parts = spec.split(' ').filter(Boolean)
  const command = parts[0] ?? 'code'
  const preArgs = parts.slice(1)
  const binary = command.split(/[/\\]/).pop() ?? command
  const gotoCapable = /^(code|code-insiders|codium|vscodium|cursor|windsurf)$/i.test(binary)
  const args = gotoCapable ? [...preArgs, '-g', `${file}:${line}`] : [...preArgs, file]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {
      /* editor binary not found — best-effort, nothing to do */
    })
    child.unref()
  } catch {
    /* spawn threw synchronously — best-effort, ignore */
  }
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
  'export function destroyInertiaDevtools() {}',
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
  const { stripInProduction = true, sourceLinks, ...runtimeOptions } = options
  const sourceLinksConfig = normalizeSourceLinks(sourceLinks)
  // Fail SAFE, not open. `configResolved` is a Vite-only hook, so a host that
  // consumes this through the plain Rollup interface never calls it and keeps
  // whatever this default says. It used to say "development": no stripping,
  // plus auto-injection — a production bundle that imports and boots the
  // devtools. An unknown host now gets the stripped behaviour and Vite flips
  // this to the truth in configResolved below.
  //
  // One flag, deliberately. There used to be a second (`isDev`) gating
  // auto-injection, and the two disagreed: `stripInProduction: false` cleared
  // `strip` but left `isDev` false, so nothing was stripped and nothing was
  // injected either. "Do we strip?" and "do we inject?" are the same question.
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

  // Resolved in configResolved: the absolute pages directory and whether the
  // source-open endpoint should mount (dev + enabled + pagesDir exists).
  let pagesDirAbs = ''
  let sourceLinksActive = false

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

      // Source links are a dev-only affordance: never in a build or test run,
      // only when enabled AND the pages directory actually exists — otherwise
      // every component name would be a dead link. `config.root` is absolute in
      // real Vite; guard it so a minimal/mock config can't throw in this hook.
      pagesDirAbs = config.root ? resolvePagesDir(config.root, sourceLinksConfig.pagesDir) : ''
      sourceLinksActive = sourceLinksConfig.enabled && !strip && pagesDirAbs !== '' && existsSync(pagesDirAbs)
    },
    configureServer(server) {
      // Only mounts in dev when active (see configResolved). Maps a component
      // name to a file under pagesDir and opens it in the editor. The resolver
      // is containment-guarded, so a crafted `?component=../../x` cannot escape.
      if (!sourceLinksActive) return
      server.middlewares.use(OPEN_ENDPOINT, (req, res) => {
        res.setHeader('content-type', 'application/json')
        // Launching an editor is a state-changing action, so it must not be
        // reachable by a cross-site GET (an <img>/link) or a drive-by request
        // from another origin. Require POST and a same-origin Origin — together
        // they reduce the endpoint to "only the dev app on this server can call
        // it". Path containment (resolveComponentSource) is the second wall.
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        if (!isSameOriginRequest(req.headers.origin, req.headers.host)) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: 'cross-origin request refused' }))
          return
        }
        const component = new URL(req.url ?? '', 'http://localhost').searchParams.get('component')
        if (!component) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'missing ?component' }))
          return
        }
        const file = resolveComponentSource(pagesDirAbs, sourceLinksConfig.extensions, component)
        if (!file) {
          res.statusCode = 404
          res.end(JSON.stringify({ component, resolved: null }))
          return
        }
        openInEditor(file)
        res.end(JSON.stringify({ component, resolved: file }))
      })
    },
    resolveId(source, importer) {
      // Both the package and its side-effect entry are intercepted: a build must
      // strip `inertia-devtools/auto` as thoroughly as the bare package, or the
      // production-strip guarantee has a hole the moment someone imports it.
      if (source === 'inertia-devtools' || source === 'inertia-devtools/auto') {
        if (strip) {
          return NOOP_ID
        }
        // Intercept bare imports from user code (not from our virtual module).
        // Routing both to INIT_ID gives a manual `/auto` import the same
        // router-carrying init the auto-injected path gets.
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
        // Add the capability flag only when the open endpoint is actually live;
        // when off, omit it (the store reads an absent flag as false) so the
        // injected options — and every test asserting them — stay as before.
        const clientOptions = sourceLinksActive ? { ...runtimeOptions, sourceLinks: true } : runtimeOptions
        const optionsJson = JSON.stringify(clientOptions)
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
      // Keyed off `strip`, not `isDev`. Gating on `isDev` meant auto-injection
      // never ran in ANY build, so `stripInProduction: false` — whose entire
      // purpose is to intentionally ship devtools — silently did nothing unless
      // the app also had a manual `import 'inertia-devtools'`. The option
      // worked on one path and no-oped on the other, and the one it failed on
      // is the path the README's Quick Start recommends.
      //
      // This is still fail-safe: `strip` defaults to true, so a host that never
      // calls `configResolved` (plain Rollup) gets no injection.
      if (strip) return
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
