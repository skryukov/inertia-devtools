import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startNetworkCapture, type NetworkTiming } from './network'

function fireEntries(entries: Partial<PerformanceResourceTiming>[]) {
  const cb = (globalThis as Record<string, unknown>).__perfObserverCb as (list: PerformanceObserverEntryList) => void
  cb({
    getEntries: () =>
      entries.map((e) => ({
        entryType: 'resource',
        initiatorType: 'fetch',
        name: '',
        startTime: 0,
        duration: 0,
        transferSize: 0,
        ...e,
      })) as PerformanceEntry[],
  } as PerformanceObserverEntryList)
}

describe('startNetworkCapture', () => {
  let stopCapture: () => void
  let captured: NetworkTiming[]
  let _observerCallback: PerformanceObserverEntryList | null = null
  let mockDisconnect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    captured = []
    mockDisconnect = vi.fn()

    // Mock PerformanceObserver
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor(cb: (list: PerformanceObserverEntryList) => void) {
          // Store callback so tests can trigger it
          _observerCallback = {
            getEntries: () => [] as PerformanceEntry[],
          } as PerformanceObserverEntryList
          ;(globalThis as Record<string, unknown>).__perfObserverCb = cb
        }
        observe() {}
        disconnect = mockDisconnect
      },
    )

    stopCapture = startNetworkCapture(
      (url) => url.includes('/inertia'),
      (timing) => captured.push(timing),
    )
  })

  afterEach(() => {
    stopCapture()
    vi.unstubAllGlobals()
  })

  it('captures timing for matching URLs', () => {
    fireEntries([
      {
        name: 'http://localhost/inertia/users',
        initiatorType: 'fetch',
        startTime: 100,
        duration: 35,
        transferSize: 1024,
      },
    ])

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://localhost/inertia/users')
    expect(captured[0].duration).toBe(35)
    expect(captured[0].startedAt).toBe(100)
    expect(captured[0].finishedAt).toBe(135)
    expect(captured[0].transferSize).toBe(1024)
  })

  it('ignores non-matching URLs', () => {
    fireEntries([
      {
        name: 'http://localhost/api/external',
        initiatorType: 'fetch',
        startTime: 100,
        duration: 20,
      },
    ])

    expect(captured).toHaveLength(0)
  })

  it('ignores non-XHR/fetch entries', () => {
    fireEntries([
      {
        name: 'http://localhost/inertia/users',
        initiatorType: 'img',
        startTime: 100,
        duration: 20,
      },
    ])

    expect(captured).toHaveLength(0)
  })

  it('captures xmlhttprequest entries', () => {
    fireEntries([
      {
        name: 'http://localhost/inertia/users',
        initiatorType: 'xmlhttprequest',
        startTime: 50,
        duration: 80,
      },
    ])

    expect(captured).toHaveLength(1)
    expect(captured[0].startedAt).toBe(50)
  })

  it('disconnects observer on teardown', () => {
    stopCapture()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
