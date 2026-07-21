import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startNetworkCapture, type NetworkTiming } from './network'

// serverTiming is widened to plain objects — PerformanceServerTiming requires toJSON.
type FakeEntry = Partial<Omit<PerformanceResourceTiming, 'serverTiming'>> & {
  serverTiming?: { name: string; duration: number; description: string }[]
}

function fireEntries(entries: FakeEntry[]) {
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

  it('captures Server-Timing metrics when present', () => {
    fireEntries([
      {
        name: 'http://localhost/inertia/users',
        initiatorType: 'fetch',
        startTime: 100,
        duration: 35,
        serverTiming: [
          { name: 'db', duration: 12.3, description: 'SELECT queries' },
          { name: 'app', duration: 20, description: '' },
        ],
      },
    ])

    expect(captured).toHaveLength(1)
    expect(captured[0].serverTiming).toEqual([
      { name: 'db', duration: 12.3, description: 'SELECT queries' },
      { name: 'app', duration: 20, description: '' },
    ])
  })

  it('omits serverTiming when the entry exposes none', () => {
    fireEntries([
      // Cross-origin without Timing-Allow-Origin — empty array
      { name: 'http://localhost/inertia/users', initiatorType: 'fetch', serverTiming: [] },
      // Entry without the field at all
      { name: 'http://localhost/inertia/roles', initiatorType: 'fetch' },
    ])

    expect(captured).toHaveLength(2)
    expect(captured[0].serverTiming).toBeUndefined()
    expect(captured[1].serverTiming).toBeUndefined()
  })

  it('captures responseStatus when the entry exposes it', () => {
    fireEntries([
      { name: 'http://localhost/inertia/users', initiatorType: 'fetch', responseStatus: 409 },
      // 0 means unavailable (cross-origin / unsupported browser)
      { name: 'http://localhost/inertia/roles', initiatorType: 'fetch', responseStatus: 0 },
      { name: 'http://localhost/inertia/teams', initiatorType: 'fetch' },
    ])

    expect(captured).toHaveLength(3)
    expect(captured[0].responseStatus).toBe(409)
    expect(captured[1].responseStatus).toBeUndefined()
    expect(captured[2].responseStatus).toBeUndefined()
  })

  it('disconnects observer on teardown', () => {
    stopCapture()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
