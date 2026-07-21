import { DevToolsStore } from './core/store'
import { createInRealmClient } from './core/client'
import { startCapture } from './core/capture'
import { startInterceptorCapture } from './core/interceptors'
import { startNetworkCapture } from './core/network'
import type { DevToolsOptions } from './core/types'

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

  const store = new DevToolsStore(options)
  window.__INERTIA_DEVTOOLS_STORE__ = store

  // Capture must never take the host app down with it
  try {
    // Start capturing events immediately (client-side visits arrive
    // via the inertia:clientVisit event — no history API patching needed)
    startCapture(store)

    // Capture wire data (headers/status/body size) via Inertia's dev-mode
    // interceptors; subscribes lazily since createInertiaApp() runs after us
    startInterceptorCapture(store)

    // PerformanceObserver supplies timing/transferSize, and is the only
    // network source when interceptors are unavailable (dev: false)
    startNetworkCapture(
      (url) => store.isInertiaRequestUrl(url),
      (timing) => store.captureNetworkTiming(timing),
    )

    // Hard reloads (409/inertia:location) land inside the session-save
    // debounce window — flush so the record that explains the reload survives
    window.addEventListener('pagehide', () => store.flushPendingSave())
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

    const shadow = host.attachShadow({ mode: 'open' })

    // Mount the devtools app (lazy-loaded) — the UI talks to the store
    // only through StoreClient, the same interface future shells (PiP,
    // iframe, extension) implement over a real transport
    const { mountDevTools } = await import('./ui/mount')
    mountDevTools(shadow, createInRealmClient(store), options)
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
