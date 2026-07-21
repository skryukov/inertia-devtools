/**
 * Network timing capture using PerformanceObserver.
 *
 * Observes Resource Timing entries for Inertia requests (matched by URL)
 * instead of monkey-patching XHR/fetch. This is non-invasive and avoids
 * conflicts with other libraries or browser extensions.
 */

export interface ServerTimingMetric {
  name: string
  duration: number // ms
  description: string
}

export interface NetworkTiming {
  url: string
  duration: number // ms
  startedAt: number // performance.now() equivalent (startTime)
  finishedAt: number // startTime + duration
  transferSize?: number // bytes (0 if served from cache)
  serverTiming?: ServerTimingMetric[] // Server-Timing response header metrics
  /** HTTP status from Resource Timing (Chrome 109+; 0 when unavailable/cross-origin). */
  responseStatus?: number
}

export type NetworkTimingCallback = (timing: NetworkTiming) => void

/**
 * Start observing Resource Timing entries for Inertia requests.
 * Returns a teardown function that disconnects the observer.
 */
export function startNetworkCapture(
  isInertiaUrl: (url: string) => boolean,
  onTiming: NetworkTimingCallback,
): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {}

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const resource = entry as PerformanceResourceTiming
      if (resource.initiatorType !== 'xmlhttprequest' && resource.initiatorType !== 'fetch') continue
      if (!isInertiaUrl(resource.name)) continue

      const timing: NetworkTiming = {
        url: resource.name,
        duration: resource.duration,
        startedAt: resource.startTime,
        finishedAt: resource.startTime + resource.duration,
        transferSize: resource.transferSize,
      }

      // Status fallback for responses no interceptor sees: non-Inertia error
      // responses (interceptors run only via setPage) and dev: false apps. On Inertia
      // 3.4/3.5 this is the ONLY signal for a 409 — the router goes straight
      // to locationVisit() without firing any event.
      if (typeof resource.responseStatus === 'number' && resource.responseStatus > 0) {
        timing.responseStatus = resource.responseStatus
      }

      // Cross-origin responses without Timing-Allow-Origin expose an empty
      // array — treat it as absent. Copy to plain objects for serialization.
      if (resource.serverTiming?.length) {
        timing.serverTiming = resource.serverTiming.map(({ name, duration, description }) => ({
          name,
          duration,
          description,
        }))
      }

      onTiming(timing)
    }
  })

  observer.observe({ type: 'resource', buffered: false })

  return () => observer.disconnect()
}
