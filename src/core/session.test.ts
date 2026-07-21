import { describe, it, expect, beforeEach } from 'vitest'
import { summarizeRequest, saveSession, loadSession, clearSession } from './session'
import type { RequestRecord } from './types'
import { DevToolsStore } from './store'

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    visitId: 1,
    type: 'full',
    method: 'GET',
    url: 'http://localhost/users',
    startedAt: 100,
    finishedAt: 250,
    duration: 150,
    completed: true,
    cancelled: false,
    interrupted: false,
    events: [],
    features: [{ type: 'partial', label: 'Partial reload' }],
    diagnostics: [],
    page: {
      component: 'Users/Index',
      props: { errors: { name: 'required' } },
      url: '/users',
      version: '1',
      encryptHistory: false,
      clearHistory: false,
      flash: {},
    },
    ...overrides,
  }
}

describe('summarizeRequest', () => {
  it('extracts correct fields from a full RequestRecord', () => {
    const req = makeRequest({
      visitId: 42,
      parentVisitId: 10,
      type: 'deferred',
      method: 'POST',
      url: 'http://localhost/submit',
      status: 200,
      startedAt: 50,
      finishedAt: 200,
      duration: 150,
      only: ['sidebar'],
      except: ['main'],
      redirectUrl: '/dashboard',
      features: [
        { type: 'deferred', label: 'Deferred' },
        { type: 'cached', label: 'Cached' },
      ],
    })

    const summary = summarizeRequest(req)

    expect(summary.visitId).toBe(42)
    expect(summary.parentVisitId).toBe(10)
    expect(summary.type).toBe('deferred')
    expect(summary.method).toBe('POST')
    expect(summary.url).toBe('http://localhost/submit')
    expect(summary.status).toBe(200)
    expect(summary.startedAt).toBe(50)
    expect(summary.finishedAt).toBe(200)
    expect(summary.duration).toBe(150)
    expect(summary.completed).toBe(true)
    expect(summary.cancelled).toBe(false)
    expect(summary.interrupted).toBe(false)
    expect(summary.only).toEqual(['sidebar'])
    expect(summary.except).toEqual(['main'])
    expect(summary.redirectUrl).toBe('/dashboard')
    expect(summary.component).toBe('Users/Index')
    expect(summary.featureTypes).toEqual(['deferred', 'cached'])
    expect(summary.hasErrors).toBe(true)
  })

  it('handles missing page and empty features', () => {
    const req = makeRequest({ page: undefined, features: [] })
    const summary = summarizeRequest(req)

    expect(summary.component).toBeUndefined()
    expect(summary.featureTypes).toEqual([])
    expect(summary.hasErrors).toBe(false)
  })

  it('handles page with no errors', () => {
    const req = makeRequest({
      page: {
        component: 'Home',
        props: {},
        url: '/',
        version: '1',
        encryptHistory: false,
        clearHistory: false,
        flash: {},
      },
    })
    const summary = summarizeRequest(req)
    expect(summary.hasErrors).toBe(false)
  })
})

describe('saveSession + loadSession', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('round-trips correctly', () => {
    const requests = [makeRequest({ visitId: 1 }), makeRequest({ visitId: 2 })]
    saveSession(requests)

    const snapshot = loadSession()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.requests).toHaveLength(2)
    expect(snapshot!.requests[0].visitId).toBe(1)
    expect(snapshot!.requests[1].visitId).toBe(2)
    expect(snapshot!.savedAt).toBeGreaterThan(0)
  })

  it('returns null when sessionStorage is empty', () => {
    expect(loadSession()).toBeNull()
  })

  it('returns null when data is expired', () => {
    const requests = [makeRequest()]
    saveSession(requests)

    // Manually set savedAt to 6 minutes ago
    const raw = sessionStorage.getItem('inertia-devtools-session')!
    const snapshot = JSON.parse(raw)
    snapshot.savedAt = Date.now() - 6 * 60 * 1000
    sessionStorage.setItem('inertia-devtools-session', JSON.stringify(snapshot))

    expect(loadSession()).toBeNull()
    // Should also clean up the expired key
    expect(sessionStorage.getItem('inertia-devtools-session')).toBeNull()
  })

  it('returns null for corrupted JSON', () => {
    sessionStorage.setItem('inertia-devtools-session', 'not-json{{{')
    expect(loadSession()).toBeNull()
  })
})

describe('clearSession', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('removes the key', () => {
    saveSession([makeRequest()])
    expect(sessionStorage.getItem('inertia-devtools-session')).not.toBeNull()

    clearSession()
    expect(sessionStorage.getItem('inertia-devtools-session')).toBeNull()
  })

  it('does not throw when key does not exist', () => {
    expect(() => clearSession()).not.toThrow()
  })
})

/**
 * `sessionStorage` is an accessor, so `typeof sessionStorage` INVOKES it and
 * throws SecurityError when site data is blocked — which is what Safari
 * "Block All Cookies", partitioned third-party iframes and cookie-blocked
 * origins effectively do. Replacing the global with a throwing getter
 * reproduces that.
 */
function withBlockedStorage(fn: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    get() {
      throw new Error('SecurityError: Access is denied for this document.')
    },
    configurable: true,
  })
  try {
    fn()
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}

describe('blocked storage (Safari "Block All Cookies", partitioned iframes)', () => {
  it('saveSession does not throw', () => {
    withBlockedStorage(() => expect(() => saveSession([])).not.toThrow())
  })

  it('loadSession returns null instead of throwing', () => {
    withBlockedStorage(() => {
      expect(() => loadSession()).not.toThrow()
      expect(loadSession()).toBeNull()
    })
  })

  it('clearSession does not throw — it runs from the panel Clear button', () => {
    withBlockedStorage(() => expect(() => clearSession()).not.toThrow())
  })

  it('the DevToolsStore constructor survives, so init() never reaches the host app', () => {
    withBlockedStorage(() => {
      expect(() => new DevToolsStore()).not.toThrow()
    })
  })

  it('store.clear() survives — it calls clearSession()', () => {
    const store = new DevToolsStore()
    withBlockedStorage(() => expect(() => store.clear()).not.toThrow())
  })
})
