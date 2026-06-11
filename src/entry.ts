import { DevToolsStore } from './core/store'
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

    // Mount the devtools app (lazy-loaded)
    const { mountDevTools } = await import('./ui/mount')
    mountDevTools(shadow, store, options)
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.groupCollapsed('[inertia-devtools] Failed to mount UI')
      console.error(err)
      console.groupEnd()
    }
  }
}

// Auto-init on side-effect import: `import 'inertia-devtools'`
// Runs immediately if no explicit createInertiaDevtools() call is made.
// Uses a microtask to allow createInertiaDevtools() to be called first.
if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    if (!initialized) {
      init(defaultOptions)
    }
  })
}
