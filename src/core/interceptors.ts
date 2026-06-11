import type { DevToolsStore } from './store'
import type { StopFunction } from './types'
import { visitUuid, wireBodySize } from './wire'

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
 * path. We attempt at init and retry on store notifications until the global
 * appears (the initial navigate fires well after app boot, so nothing is missed).
 *
 * Handlers observe only: they return their input unchanged and swallow their
 * own errors — devtools must never break the host app's requests.
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

/**
 * Hostile-host safe: the global may be a Proxy or accessor that throws.
 * Any failure reads as "interceptors unavailable".
 */
function getInterceptors(): VisitInterceptorsLike | null {
  try {
    if (typeof window === 'undefined') return null
    const candidate = (window as Window & { __inertia_interceptors__?: unknown }).__inertia_interceptors__
    if (candidate == null || typeof candidate !== 'object') return null
    const obj = candidate as VisitInterceptorsLike
    if (typeof obj.onVisitRequest !== 'function' || typeof obj.onVisitResponse !== 'function') return null
    return obj
  } catch {
    return null
  }
}

function subscribe(store: DevToolsStore): StopFunction | null {
  const interceptors = getInterceptors()
  if (!interceptors) return null

  let stopRequest: StopFunction | null = null
  try {
    stopRequest = interceptors.onVisitRequest((visit, config) => {
      try {
        const uuid = visitUuid(visit)
        if (uuid) {
          store.attachWireRequest(uuid, {
            method: String(config?.method ?? 'get').toUpperCase(),
            url: String(config?.url ?? ''),
            // copy: other interceptors may mutate the config object after us
            headers: { ...config?.headers },
            startedAt: performance.now(),
          })
        }
      } catch {
        /* observe only */
      }
      return config
    })

    const stopResponse = interceptors.onVisitResponse((visit, response) => {
      try {
        const uuid = visitUuid(visit)
        if (uuid) {
          store.attachWireResponse(uuid, {
            status: typeof response?.status === 'number' ? response.status : undefined,
            headers: { ...response?.headers },
            bodySize: wireBodySize(response?.data),
            finishedAt: performance.now(),
          })
        }
      } catch {
        /* observe only */
      }
      return response
    })

    return () => {
      try {
        stopRequest?.()
      } catch {
        /* observe only */
      }
      try {
        stopResponse()
      } catch {
        /* observe only */
      }
    }
  } catch {
    // registration itself threw (hostile interceptors object) — clean up the half-subscription
    try {
      stopRequest?.()
    } catch {
      /* observe only */
    }
    return null
  }
}

/**
 * Start capturing wire data. Tries to subscribe immediately; if the global
 * isn't exposed yet, retries on store notifications. After a failed retry the
 * UI labels network data as fallback (PerformanceObserver-only), but retrying
 * continues — if the global appears later (late app boot), capture upgrades
 * to interceptors without losing the session.
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
    if (stop) unsubscribe()
  })

  return () => {
    unsubscribe()
    stop?.()
  }
}
