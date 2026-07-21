/**
 * Memoised because `hasRequestWithUrl` is wired into a PerformanceObserver as
 * the "is this ours?" test, so it runs once per record for EVERY resource entry
 * the host page produces — Inertia or not. With a 200-record buffer that was
 * 201 `new URL()` parses per analytics beacon, all thrown away. Measured at 200
 * records: 134.8 µs -> 4.7 µs per host XHR.
 *
 * A URL->record index would be faster still, but it has to be maintained at
 * insert, evict AND every `record.url` reassignment (redirects and clientVisit
 * both rewrite it). A stale entry there silently changes which network timings
 * get captured, which is a correctness bug traded for a speed-up. `normalizeUrl`
 * is a pure function of its argument, so a cache of it cannot go stale.
 */
const cache = new Map<string, string>()

/**
 * Bounded: probe URLs come from the host page's resource entries, which are
 * unbounded on a long-lived SPA. Cleared wholesale rather than evicted one by
 * one — this is a hot path, and the refill is cheap.
 */
const MAX_CACHE = 500

/** Normalize a URL to pathname + search for comparison. */
export function normalizeUrl(url: string): string {
  const hit = cache.get(url)
  if (hit !== undefined) return hit

  let normalized: string
  try {
    const u = new URL(url, 'http://localhost')
    normalized = u.pathname + u.search
  } catch {
    normalized = url
  }

  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(url, normalized)
  return normalized
}
