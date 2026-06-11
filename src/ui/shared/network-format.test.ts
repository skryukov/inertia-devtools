import { describe, it, expect } from 'vitest'
import { sortedHeaders, statusKind, formatBytes, networkDuration, timingLine, captureModeNotice } from './network-format'
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

describe('formatBytes', () => {
  it('labels zero bytes as cached', () => {
    expect(formatBytes(0)).toBe('cached')
  })

  it('formats bytes and kilobytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
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
  it('returns a notice in fallback mode without wire data', () => {
    expect(captureModeNotice('fallback', makeRecord())).toMatch(/interceptors unavailable/i)
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
