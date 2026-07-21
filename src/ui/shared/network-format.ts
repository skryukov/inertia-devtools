import type { NetworkCaptureMode, RequestRecord } from '../../core/types'
import { formatBytes } from './format'

/**
 * Presentation helpers for the Network tab.
 * Kept out of the component so the logic is unit-testable.
 */

// Re-export from core so existing Svelte imports keep working.
export { isInertiaHeader, sortedHeaders } from '../../core/headers'
export type { HeaderEntry } from '../../core/headers'

export type StatusKind = 'success' | 'redirect' | 'error'

export function statusKind(status: number): StatusKind {
  if (status >= 200 && status < 300) return 'success'
  if ((status >= 300 && status < 400) || status === 409) return 'redirect'
  return 'error'
}

/** Byte count for display; 0 transferred bytes means the browser served from cache. */
export function formatTransferSize(bytes: number): string {
  return bytes === 0 ? 'cached' : formatBytes(bytes)
}

/** Duration in ms — wire timestamps when available, PerformanceObserver timing otherwise. */
export function networkDuration(record: RequestRecord): number | null {
  const wire = record.wire
  if (wire?.request && wire.response) {
    return wire.response.finishedAt - wire.request.startedAt
  }
  if (record.network?.duration != null) return record.network.duration
  return null
}

/** "245ms · 12.3 KB" — duration plus the best available size source. */
export function timingLine(record: RequestRecord): string | null {
  const parts: string[] = []

  const duration = networkDuration(record)
  if (duration !== null) parts.push(`${Math.round(duration)}ms`)

  // transferSize is actual wire bytes (post-compression); bodySize is the
  // decoded response body length from the interceptor.
  if (record.network?.transferSize !== undefined) {
    parts.push(formatTransferSize(record.network.transferSize))
  } else if (record.wire?.response?.bodySize !== undefined) {
    parts.push(formatTransferSize(record.wire.response.bodySize))
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Tooltip explaining which sources produced the timing line — the interceptor
 * duration includes Inertia's JS pipeline (it is NOT pure network time), and
 * transferSize (compressed wire bytes) differs from bodySize (decoded bytes).
 * Browser Network-panel numbers will disagree; this says why.
 */
export function timingTitle(record: RequestRecord): string | null {
  const parts: string[] = []

  if (record.wire?.request && record.wire.response) {
    parts.push('duration: Inertia interceptors — includes client-side processing, not pure network time')
  } else if (record.network?.duration != null) {
    parts.push('duration: Resource Timing (network time)')
  }

  if (record.network?.transferSize !== undefined) {
    parts.push('size: transferred bytes (compressed)')
  } else if (record.wire?.response?.bodySize !== undefined) {
    parts.push('size: decoded body bytes (interceptor)')
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

export interface ServerTimingRow {
  name: string
  description: string // empty string when the metric has no description
  durationLabel: string // "12.3ms"
  barPct: number // bar width as a percentage of the largest metric (0–100)
}

/** Server-Timing durations are often sub-millisecond, so keep one decimal for fractional values. */
function formatMetricDuration(ms: number): string {
  return `${Number.isInteger(ms) ? ms : ms.toFixed(1)}ms`
}

/** Rows for the Server Timing section, with bar widths relative to the largest metric. */
export function serverTimingRows(record: RequestRecord): ServerTimingRow[] {
  const metrics = record.network?.serverTiming
  if (!metrics?.length) return []

  const max = Math.max(...metrics.map((m) => m.duration))
  return metrics.map((m) => ({
    name: m.name,
    description: m.description,
    durationLabel: formatMetricDuration(m.duration),
    barPct: max > 0 ? (m.duration / max) * 100 : 0,
  }))
}

/** Empty-state message: cache-served visits never made a request — say so instead of "no data". */
export function emptyStateMessage(record: RequestRecord): string {
  if (record.cached) return 'Served from the prefetch cache — no request was made'
  return 'No network data captured for this visit'
}

/** Notice describing degraded capture, or null when wire data is available. */
export function captureModeNotice(mode: NetworkCaptureMode, record: RequestRecord): string | null {
  if (record.type === 'client') return null
  if (record.wire?.request || record.wire?.response) return null
  if (mode === 'fallback') {
    // State the fact plus both plausible causes — we can't tell them apart.
    return "Timing only — Inertia's dev-mode interceptors are not available (dev option disabled, or an incompatible Inertia version)"
  }
  return null
}

/**
 * One-line caveat for records WITH wire data — what the interceptor snapshot
 * does not show.
 *
 * In @inertiajs/core 3.4.0 dist, Request.send() awaits
 * `interceptors.processRequest(...)` (our snapshot) BEFORE handing the config
 * to `http.getClient().request(...)`; XhrHttpClient.doRequest() then injects
 * `X-XSRF-TOKEN` (from the XSRF-TOKEN cookie) and `Content-Type:
 * application/json` via `xhr.setRequestHeader`, so those headers never appear
 * in the snapshot. XHR also follows redirects transparently, so
 * `onVisitResponse` only ever sees the final hop (a POST → 303 → GET is one
 * record with the final status).
 */
export function wireCaveat(record: RequestRecord): string | null {
  if (!record.wire?.request && !record.wire?.response) return null
  return "Request headers are captured before Inertia's HTTP client adds X-XSRF-TOKEN and Content-Type, and redirects are followed transparently (final response only) — the browser's Network panel is the HTTP source of truth"
}
