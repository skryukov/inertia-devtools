import type { DevToolsStore } from './store'
import type { StopFunction } from './types'
import { visitUuid, wireBodySize } from './wire'

/**
 * Wire-data capture via Inertia's dev-mode request/response interceptors.
 *
 * Inertia >= 3.4 exposes `window.__inertia_interceptors__` when
 * `createInertiaApp({ dev })` is truthy (default: import.meta.env.DEV).
 * The request interceptor fires for all router traffic (visits, prefetches,
 * deferred reloads, polls). The response interceptor runs inside
 * Response.setPage() (3.4.0 dist: `interceptors.processResponse`), so it fires
 * for any Inertia response that goes on to update the page — including status
 * >= 400 when the cancelable `inertia:httpException` event isn't prevented —
 * but not for non-Inertia responses, prefetch fills, or responses that skip
 * setPage. The correlator additionally extracts prefetch responses and HTTP
 * exceptions from their lifecycle events.
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
          const request = {
            method: String(config?.method ?? 'get').toUpperCase(),
            url: String(config?.url ?? ''),
            // copy: other interceptors may mutate the config object after us
            headers: { ...config?.headers },
            startedAt: performance.now(),
          }
          // This handler runs synchronously inside Request.send(), in the same
          // task as the before/start events — which capture.ts holds in its
          // microtask buffer. Queue the attach behind that flush so the record
          // exists by the time it resolves.
          queueMicrotask(() => {
            try {
              store.attachWireRequest(uuid, request)
            } catch {
              /* observe only */
            }
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
