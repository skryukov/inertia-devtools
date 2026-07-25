import { describe, it, expect } from 'vitest'
import {
  sortedHeaders,
  statusKind,
  formatTransferSize,
  networkDuration,
  timingTitle,
  timingLine,
  captureModeNotice,
  wireCaveat,
  emptyStateMessage,
  serverTimingRows,
} from './network-format'
import type { RequestRecord } from '../../core/types'

function makeRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    visitId: 1,
    type: 'full',
    method: 'GET',
    url: '/users',
    startedAt: 100,
    events: [],
    features: [],
    diagnostics: [],
    cancelled: false,
    interrupted: false,
    completed: true,
    ...overrides,
  }
}

describe('sortedHeaders', () => {
  it('puts X-Inertia-* headers first, then alphabetical', () => {
    const result = sortedHeaders({
      accept: 'text/html',
      'X-Inertia-Version': 'abc',
      'content-type': 'application/json',
      'X-Inertia': 'true',
    })
    expect(result.map((h) => h.name)).toEqual(['X-Inertia', 'X-Inertia-Version', 'accept', 'content-type'])
  })

  it('returns empty array for missing headers', () => {
    expect(sortedHeaders(undefined)).toEqual([])
  })
})

describe('statusKind', () => {
  it('classifies 2xx as success', () => {
    expect(statusKind(200)).toBe('success')
    expect(statusKind(204)).toBe('success')
  })

  it('classifies 3xx and 409 as redirect', () => {
    expect(statusKind(302)).toBe('redirect')
    expect(statusKind(409)).toBe('redirect')
  })

  it('classifies 4xx/5xx as error', () => {
    expect(statusKind(422)).toBe('error')
    expect(statusKind(500)).toBe('error')
  })
})

describe('formatTransferSize', () => {
  it('labels zero bytes as cached', () => {
    expect(formatTransferSize(0)).toBe('cached')
  })

  it('formats bytes and kilobytes', () => {
    expect(formatTransferSize(512)).toBe('512 B')
    expect(formatTransferSize(2048)).toBe('2.0 KB')
  })
})

describe('networkDuration / timingLine', () => {
  it('prefers wire timestamps over PerformanceObserver timing', () => {
    const record = makeRecord({
      wire: {
        request: { method: 'GET', url: '/users', headers: {}, startedAt: 100 },
        response: { status: 200, headers: {}, finishedAt: 350 },
      },
      network: { url: '/users', duration: 999, startedAt: 0, finishedAt: 999 },
    })
    expect(networkDuration(record)).toBe(250)
  })

  it('falls back to PerformanceObserver duration', () => {
    const record = makeRecord({
      network: { url: '/users', duration: 120, startedAt: 100, finishedAt: 220, transferSize: 3500 },
    })
    expect(networkDuration(record)).toBe(120)
    expect(timingLine(record)).toBe('120ms · 3.4 KB')
  })

  it('uses bodySize when transferSize is unavailable', () => {
    const record = makeRecord({
      wire: {
        request: { method: 'GET', url: '/users', headers: {}, startedAt: 100 },
        response: { status: 200, headers: {}, bodySize: 512, finishedAt: 200 },
      },
    })
    expect(timingLine(record)).toBe('100ms · 512 B')
  })

  it('returns null with no data', () => {
    expect(timingLine(makeRecord())).toBeNull()
  })
})

describe('captureModeNotice', () => {
  it('returns a notice naming both plausible causes in fallback mode without wire data', () => {
    const notice = captureModeNotice('fallback', makeRecord())
    expect(notice).toMatch(/interceptors are not available/i)
    expect(notice).toMatch(/dev option disabled/i)
    expect(notice).toMatch(/incompatible Inertia version/i)
  })

  it('returns null when wire data is present', () => {
    const record = makeRecord({
      wire: { request: { method: 'GET', url: '/u', headers: {}, startedAt: 1 } },
    })
    expect(captureModeNotice('fallback', record)).toBeNull()
  })

  it('returns null for interceptors and pending modes', () => {
    expect(captureModeNotice('interceptors', makeRecord())).toBeNull()
    expect(captureModeNotice('pending', makeRecord())).toBeNull()
  })

  it('returns null for client visits (no network activity)', () => {
    expect(captureModeNotice('fallback', makeRecord({ type: 'client' }))).toBeNull()
  })
})

describe('wireCaveat', () => {
  it('returns null without wire data', () => {
    expect(wireCaveat(makeRecord())).toBeNull()
    expect(wireCaveat(makeRecord({ network: { url: '/u', duration: 12, startedAt: 1, finishedAt: 13 } }))).toBeNull()
  })

  it('caveats the pre-client header snapshot and transparent redirects when wire data is present', () => {
    const caveat = wireCaveat(
      makeRecord({
        wire: { request: { method: 'GET', url: '/u', headers: {}, startedAt: 1 } },
      }),
    )
    expect(caveat).toMatch(/before Inertia's HTTP client adds X-XSRF-TOKEN and Content-Type/)
    expect(caveat).toMatch(/redirects are followed transparently/)
    expect(caveat).toMatch(/browser's Network panel is the HTTP source of truth/)
  })

  it('returns the caveat for response-only wire data', () => {
    const caveat = wireCaveat(
      makeRecord({
        wire: { response: { status: 200, headers: {}, finishedAt: 5 } },
      }),
    )
    expect(caveat).not.toBeNull()
  })
})

describe('serverTimingRows', () => {
  it('returns empty array without Server-Timing data', () => {
    expect(serverTimingRows(makeRecord())).toEqual([])
    expect(
      serverTimingRows(makeRecord({ network: { url: '/users', duration: 100, startedAt: 0, finishedAt: 100 } })),
    ).toEqual([])
  })

  it('maps metrics to rows with bar widths relative to the largest metric', () => {
    const record = makeRecord({
      network: {
        url: '/users',
        duration: 100,
        startedAt: 0,
        finishedAt: 100,
        serverTiming: [
          { name: 'db', duration: 25, description: 'SELECT queries' },
          { name: 'app', duration: 50, description: '' },
        ],
      },
    })
    expect(serverTimingRows(record)).toEqual([
      { name: 'db', description: 'SELECT queries', durationLabel: '25ms', barPct: 50 },
      { name: 'app', description: '', durationLabel: '50ms', barPct: 100 },
    ])
  })

  it('keeps one decimal for fractional durations', () => {
    const record = makeRecord({
      network: {
        url: '/users',
        duration: 100,
        startedAt: 0,
        finishedAt: 100,
        serverTiming: [{ name: 'cache', duration: 0.42, description: '' }],
      },
    })
    expect(serverTimingRows(record)[0].durationLabel).toBe('0.4ms')
  })

  it('uses zero-width bars when all durations are zero', () => {
    const record = makeRecord({
      network: {
        url: '/users',
        duration: 100,
        startedAt: 0,
        finishedAt: 100,
        serverTiming: [{ name: 'cache', duration: 0, description: 'hit' }],
      },
    })
    expect(serverTimingRows(record)[0].barPct).toBe(0)
  })
})

describe('emptyStateMessage', () => {
  it('explains cache-served visits instead of claiming missing data', () => {
    expect(emptyStateMessage(makeRecord({ cached: true }))).toBe('Served from the prefetch cache — no request was made')
  })

  it('reports missing network data otherwise', () => {
    expect(emptyStateMessage(makeRecord())).toBe('No network data captured for this visit')
  })
})

describe('networkDuration zero handling', () => {
  it('shows a legitimate 0ms Resource Timing duration', () => {
    const record = makeRecord({ network: { url: '/u', duration: 0, startedAt: 1, finishedAt: 1 } })
    expect(networkDuration(record)).toBe(0)
  })
})

describe('timingTitle', () => {
  it('labels interceptor duration as including client-side processing', () => {
    const record = makeRecord({
      wire: {
        request: { method: 'GET', url: '/u', headers: {}, startedAt: 0 },
        response: { headers: {}, bodySize: 10, finishedAt: 5 },
      },
    })
    expect(timingTitle(record)).toContain('not pure network time')
    expect(timingTitle(record)).toContain('decoded body bytes')
  })

  it('labels Resource Timing fallback as network time', () => {
    const record = makeRecord({ network: { url: '/u', duration: 12, startedAt: 1, finishedAt: 13, transferSize: 100 } })
    expect(timingTitle(record)).toContain('Resource Timing')
    expect(timingTitle(record)).toContain('compressed')
  })
})
