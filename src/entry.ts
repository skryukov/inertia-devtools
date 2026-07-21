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

// Browser package without Node types — process exists only via bundler
// replacement (see isProdBuild below).
declare const process: { env: Record<string, string | undefined> }

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
 * Auto-init must never reach production. Bundlers textually replace
 * `process.env.NODE_ENV`, so the expression must stay bare for the
 * replacement to make this branch dead code in prod builds (a `typeof
 * process` guard would survive replacement and defeat the gate in browsers).
 * Where nothing replaces it and no `process` global exists (Vite dev serves
 * this package unbundled), the ReferenceError lands in the catch and
 * boot-on-import behavior is preserved.
 * An explicit createInertiaDevtools() call is NOT gated — intentionally
 * shipping devtools (strip disabled + explicit call) stays possible.
 */
const isProdBuild = (() => {
  try {
    return process.env.NODE_ENV === 'production'
  } catch {
    return false
  }
})()

// Auto-init on side-effect import: `import 'inertia-devtools'`
// Runs immediately if no explicit createInertiaDevtools() call is made.
// Uses a microtask to allow createInertiaDevtools() to be called first.
if (typeof window !== 'undefined' && !isProdBuild) {
  queueMicrotask(() => {
    if (!initialized) {
      init(defaultOptions)
    }
  })
}
