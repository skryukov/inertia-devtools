import type { DevToolsStore } from './store'
import type { StopFunction } from './types'

/**
 * Wire-data capture via Inertia's dev-mode request/response interceptors.
 *
 * Inertia >= 3.4 exposes `window.__inertia_interceptors__` when
 * `createInertiaApp({ dev })` is truthy (default: import.meta.env.DEV).
 * The request interceptor fires for all router traffic (visits, prefetches,
 * deferred reloads, polls); the response interceptor fires only for 2xx
 * Inertia responses — prefetch responses and HTTP exceptions are extracted
 * from their lifecycle events in the correlator instead.
 *
 * Subscription is lazy: `exposeInterceptors()` runs synchronously at the top
 * of `createInertiaApp()`, which is AFTER devtools init on the injected-import
 * path. We attempt at init and retry when the first Inertia event arrives
 * (the initial navigate fires well after app boot, so nothing is missed).
 */

interface VisitLike {
  id?: unknown
}

interface RequestConfigLike {
  method?: unknown
  url?: unknown
  headers?: Record<string, string>
}

interface ResponseLike {
  status?: unknown
  data?: unknown
  headers?: Record<string, string>
}

interface VisitInterceptorsLike {
  onVisitRequest(handler: (visit: VisitLike, config: RequestConfigLike) => RequestConfigLike): StopFunction
  onVisitResponse(handler: (visit: VisitLike, response: ResponseLike) => ResponseLike): StopFunction
}

/** Byte size of a response body string (UTF-8). */
export function wireBodySize(data: unknown): number | undefined {
  if (typeof data !== 'string') return undefined
  try {
    return new TextEncoder().encode(data).length
  } catch {
    return data.length
  }
}

function getInterceptors(): VisitInterceptorsLike | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { __inertia_interceptors__?: unknown }).__inertia_interceptors__
  if (candidate == null || typeof candidate !== 'object') return null
  const obj = candidate as VisitInterceptorsLike
  if (typeof obj.onVisitRequest !== 'function' || typeof obj.onVisitResponse !== 'function') return null
  return obj
}

function visitUuid(visit: VisitLike | undefined): string | undefined {
  const id = visit?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Subscribe pure-observation handlers. Handlers always return their input
 * unchanged and never throw — devtools must never break the host app's requests.
 */
function subscribe(store: DevToolsStore): StopFunction | null {
  const interceptors = getInterceptors()
  if (!interceptors) return null

  const stopRequest = interceptors.onVisitRequest((visit, config) => {
    try {
      const uuid = visitUuid(visit)
      if (uuid) {
        store.attachWireRequest(uuid, {
          method: String(config?.method ?? 'get').toUpperCase(),
          url: String(config?.url ?? ''),
          headers: { ...config?.headers },
          startedAt: performance.now(),
        })
      }
    } catch {
      // never break the host app
    }
    return config
  })

  const stopResponse = interceptors.onVisitResponse((visit, response) => {
    try {
      const uuid = visitUuid(visit)
      if (uuid) {
        store.attachWireResponse(uuid, {
          status: typeof response?.status === 'number' ? response.status : 0,
          headers: { ...response?.headers },
          bodySize: wireBodySize(response?.data),
          finishedAt: performance.now(),
        })
      }
    } catch {
      // never break the host app
    }
    return response
  })

  return () => {
    try {
      stopRequest()
    } catch {
      /* noop */
    }
    try {
      stopResponse()
    } catch {
      /* noop */
    }
  }
}

/**
 * Start capturing wire data. Tries to subscribe immediately; if the global
 * isn't exposed yet, retries when the first Inertia event arrives. If it's
 * still absent then (app sets dev: false), settles into fallback mode —
 * the UI labels network data as PerformanceObserver-only.
 *
 * Returns a teardown function.
 */
export function startInterceptorCapture(store: DevToolsStore): StopFunction {
  let stop = subscribe(store)
  if (stop) {
    store.setNetworkCaptureMode('interceptors')
    return () => stop?.()
  }

  const unsubscribe = store.subscribe(() => {
    if (stop) return
    stop = subscribe(store)
    store.setNetworkCaptureMode(stop ? 'interceptors' : 'fallback')
    unsubscribe()
  })

  return () => {
    unsubscribe()
    stop?.()
  }
}
