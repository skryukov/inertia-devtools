import { DevToolsStore } from './core/store'
import { createInRealmClient } from './core/client'
import { startCapture } from './core/capture'
import { startInterceptorCapture } from './core/interceptors'
import { startNetworkCapture } from './core/network'
import type { DevToolsOptions, StopFunction } from './core/types'

declare global {
  interface Window {
    __INERTIA_DEVTOOLS__?: boolean
    __INERTIA_DEVTOOLS_STORE__?: DevToolsStore
  }
}

let initialized = false
let defaultOptions: DevToolsOptions = {}
/**
 * Capture teardowns. Every start* function returns one and all three used to be
 * discarded, along with the `pagehide` listener — so during the devtools' own
 * HMR each reload stacked another set of live listeners on the page, while the
 * re-evaluated module was a permanent no-op: `initialized` resets but
 * `window.__INERTIA_DEVTOOLS__` does not.
 */
const teardowns: StopFunction[] = []

/**
 * Stop capture, unmount the UI, remove the shadow host, and release the init
 * guards so a fresh `createInertiaDevtools()` can take over.
 *
 * The comment here used to say "used by the HMR hook below". There is no HMR
 * hook — `import.meta.hot` appears nowhere in this package — and nothing called
 * this function at all, which is how it went unnoticed that it only tore down
 * half of what it claimed: capture stopped, but the host element, the Svelte
 * app, its document keydown listener and the store subscription all survived.
 */
export function destroyInertiaDevtools(): void {
  while (teardowns.length) {
    try {
      teardowns.pop()?.()
    } catch {
      /* teardown must not throw on the way out either */
    }
  }
  initialized = false
  if (typeof window !== 'undefined') {
    delete window.__INERTIA_DEVTOOLS__
    delete window.__INERTIA_DEVTOOLS_STORE__
  }
}

export function createInertiaDevtools(options: DevToolsOptions = {}): void {
  defaultOptions = options
  init(options)
}

function init(options: DevToolsOptions): void {
  // SSR guard
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  // Already initialized guard
  if (initialized || window.__INERTIA_DEVTOOLS__) return

  // Disabled guard
  if (options.enabled === false) return

  initialized = true
  window.__INERTIA_DEVTOOLS__ = true

  // Guarded, not bare: the constructor reads persisted state, and storage
  // access throws outright when site data is blocked (Safari "Block All
  // Cookies", partitioned iframes). A throw here escapes init() ->
  // createInertiaDevtools() -> the plugin's injected _init() and lands in the
  // host app's entrypoint at module-eval time. Its own try because there is
  // nothing to show without a store — capture failing below is survivable,
  // this is not.
  let store: DevToolsStore
  try {
    store = new DevToolsStore(options)
    window.__INERTIA_DEVTOOLS_STORE__ = store
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.groupCollapsed('[inertia-devtools] Failed to start — devtools are disabled for this page')
      console.error(err)
      console.groupEnd()
    }
    return
  }

  // Capture must never take the host app down with it
  try {
    // Start capturing events immediately (client-side visits arrive
    // via the inertia:clientVisit event — no history API patching needed)
    teardowns.push(startCapture(store))

    // Capture wire data (headers/status/body size) via Inertia's dev-mode
    // interceptors; subscribes lazily since createInertiaApp() runs after us
    teardowns.push(startInterceptorCapture(store))

    // PerformanceObserver supplies timing/transferSize, and is the only
    // network source when interceptors are unavailable (dev: false)
    teardowns.push(
      startNetworkCapture(
        (url) => store.isInertiaRequestUrl(url),
        (timing) => store.captureNetworkTiming(timing),
      ),
    )

    // Hard reloads (409/inertia:location) land inside the session-save
    // debounce window — flush so the record that explains the reload survives
    const flush = () => store.flushPendingSave()
    window.addEventListener('pagehide', flush)
    teardowns.push(() => window.removeEventListener('pagehide', flush))

    // Cancel any pending debounced session write on teardown, or a timer from
    // the last notify() fires after destroy and persists a stale session.
    teardowns.push(() => store.dispose())
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.groupCollapsed('[inertia-devtools] Failed to start capture')
      console.error(err)
      console.groupEnd()
    }
  }

  // Mount UI when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountUI(store, options), { once: true })
  } else {
    mountUI(store, options)
  }
}

async function mountUI(store: DevToolsStore, options: DevToolsOptions): Promise<void> {
  try {
    // Create Shadow DOM host
    const host = document.createElement('div')
    host.id = 'inertia-devtools-host'
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;inset:0;'
    document.body.appendChild(host)

    // Registered before the await so a destroy() racing the dynamic import
    // still removes the host element — otherwise the node outlives the teardown
    // and the next init stacks a second one on top of it.
    teardowns.push(() => host.remove())

    const shadow = host.attachShadow({ mode: 'open' })

    // Mount the devtools app (lazy-loaded) — the UI talks to the store
    // only through StoreClient, the same interface future shells (PiP,
    // iframe, extension) implement over a real transport
    const { mountDevTools } = await import('./ui/mount')
    const unmount = await mountDevTools(shadow, createInRealmClient(store), options)
    // Lost the race: destroy() ran while the chunk was loading, so tear the
    // freshly-mounted app straight back down instead of leaking it.
    if (!initialized) {
      unmount()
      host.remove()
      return
    }
    teardowns.push(unmount)
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.groupCollapsed('[inertia-devtools] Failed to mount UI')
      console.error(err)
      console.groupEnd()
    }
  }
}

/**
 * Auto-init must never reach production, and it must FAIL CLOSED — boot only
 * when something affirmatively tells us this is a dev environment.
 *
 * The old gate asked `process.env.NODE_ENV === 'production'` and returned
 * `false` (→ auto-boot) on any error. That is fail-OPEN: in a browser with no
 * bundler substitution — Rails importmap pinned to a CDN, the project's own
 * `docsProvider: 'inertia-rails'` audience — `process` is undefined, the access
 * throws, the catch returns false, and full capture boots on a production page,
 * exposing every captured record on `window.__INERTIA_DEVTOOLS_STORE__`.
 *
 * Now each signal must say "dev" explicitly:
 * - `import.meta.env.DEV` — Vite statically replaces this (true in `vite dev`,
 *   false in `vite build`), and it needs no `process`, so it is the one signal
 *   that survives the unbundled path. This preserves boot-on-import for Vite dev.
 * - `process.env.NODE_ENV` — textually replaced by webpack/Rollup/esbuild; a
 *   bundled non-Vite dev build reads 'development' here.
 * - neither present → unbundled and unidentifiable → do NOT boot.
 *
 * An explicit createInertiaDevtools() call is NOT gated — intentionally shipping
 * devtools (strip disabled + explicit call) stays possible.
 */
/**
 * Fail-CLOSED auto-init decision, pure so it can actually be tested (the old
 * inline IIFE could not — see entry.test.ts). Boot only when a signal says
 * "dev" outright:
 * - `importMetaDev` is `import.meta.env.DEV`, which Vite statically replaces and
 *   which needs no `process`, so it survives the unbundled path.
 * - otherwise `readNodeEnv()` reads the bundler-replaced NODE_ENV.
 * - if reading it throws — unbundled browser, no `process` — return false. The
 *   old code returned TRUE here, which auto-booted full capture onto any CDN /
 *   importmap production page.
 */
export function shouldAutoInit(importMetaDev: unknown, readNodeEnv: () => string | undefined): boolean {
  if (typeof importMetaDev === 'boolean') return importMetaDev
  try {
    return readNodeEnv() !== 'production'
  } catch {
    return false
  }
}

/**
 * Boot on a microtask unless an explicit `createInertiaDevtools()` already ran.
 * Called only from the side-effect entry `inertia-devtools/auto`; this module
 * itself has NO top-level side effect, so `import 'inertia-devtools'` is pure
 * and fully tree-shakeable (`sideEffects: ["./dist/auto.js"]`). Splitting it out
 * is what stopped ~200 KB of dead devtools shipping to webpack/Rollup consumers
 * behind a guarded snippet.
 */
export function autoInitIfIdle(): void {
  queueMicrotask(() => {
    if (!initialized) {
      init(defaultOptions)
    }
  })
}
