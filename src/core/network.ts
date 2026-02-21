/**
 * Network timing capture using PerformanceObserver.
 *
 * Observes Resource Timing entries for Inertia requests (matched by URL)
 * instead of monkey-patching XHR/fetch. This is non-invasive and avoids
 * conflicts with other libraries or browser extensions.
 */

export interface NetworkTiming {
  url: string
  duration: number // ms
  startedAt: number // performance.now() equivalent (startTime)
  finishedAt: number // startTime + duration
  transferSize?: number // bytes (0 if served from cache)
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

      onTiming({
        url: resource.name,
        duration: resource.duration,
        startedAt: resource.startTime,
        finishedAt: resource.startTime + resource.duration,
        transferSize: resource.transferSize,
      })
    }
  })

  observer.observe({ type: 'resource', buffered: false })

  return () => observer.disconnect()
}
