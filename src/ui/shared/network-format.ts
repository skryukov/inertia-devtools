import type { NetworkCaptureMode, RequestRecord } from '../../core/types'
import { formatBytes } from './format'

/**
 * Presentation helpers for the Network tab.
 * Kept out of the component so the logic is unit-testable.
 */

export interface HeaderEntry {
  name: string
  value: string
}

export const isInertiaHeader = (name: string) => name.toLowerCase().startsWith('x-inertia')

/** Sort headers for display: X-Inertia-* first, then alphabetical. */
export function sortedHeaders(headers: Record<string, string> | undefined): HeaderEntry[] {
  if (!headers) return []
  const entries = Object.entries(headers).map(([name, value]) => ({ name, value }))
  return entries.toSorted((a, b) => {
    const ai = isInertiaHeader(a.name)
    const bi = isInertiaHeader(b.name)
    if (ai !== bi) return ai ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

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
  if (record.network?.duration) return record.network.duration
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

/** Notice describing degraded capture, or null when wire data is available. */
export function captureModeNotice(mode: NetworkCaptureMode, record: RequestRecord): string | null {
  if (record.type === 'client') return null
  if (record.wire?.request || record.wire?.response) return null
  if (mode === 'fallback') {
    return 'Timing only — Inertia interceptors unavailable (app disables the dev option)'
  }
  return null
}
