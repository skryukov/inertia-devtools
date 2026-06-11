import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevToolsStore } from './store'

function makeCustomEvent(name: string, detail: unknown = {}): CustomEvent {
  return new CustomEvent(name, { detail })
}

describe('DevToolsStore', () => {
  let store: DevToolsStore

  beforeEach(() => {
    store = new DevToolsStore()
  })

  describe('initial state', () => {
    it('starts with empty state', () => {
      const state = store.getState()
      expect(state.requests).toEqual([])
      expect(state.currentPage).toBeNull()
      expect(state.evictedCount).toBe(0)
    })
  })

  describe('captureEvent', () => {
    it('captures a DOM event and creates a request record', () => {
      const visit = {
        id: 'visit-1',
        method: 'get',
        url: new URL('http://localhost/users'),
        completed: false,
        cancelled: false,
        interrupted: false,
        only: [],
        except: [],
        prefetch: false,
      }

      store.setPanelOpen(true)
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit }))

      const state = store.getState()
      expect(state.requests).toHaveLength(1)
      expect(state.requests[0].method).toBe('GET')
    })

    it('serializes URL objects in event detail', () => {
      const visit = {
        id: 'visit-2',
        method: 'get',
        url: new URL('http://localhost/test?foo=bar'),
        only: [],
        except: [],
      }

      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit }))

      const state = store.getState()
      expect(state.requests).toHaveLength(1)
    })

    it('safely handles null/undefined detail', () => {
      store.captureEvent('inertia:navigate', makeCustomEvent('inertia:navigate', null))
      // Should not throw
      expect(store.getState().requests).toHaveLength(0)
    })
  })

  describe('legacy Inertia warning', () => {
    it('warns once when visit events carry no id (pre-3.4)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const legacyVisit = { method: 'get', url: new URL('http://localhost/a'), only: [], except: [] }
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: legacyVisit }))
      store.captureEvent('inertia:start', makeCustomEvent('inertia:start', { visit: legacyVisit }))

      const legacyWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('requires Inertia >= 3.4'))
      expect(legacyWarnings).toHaveLength(1)
      warnSpy.mockRestore()
    })

    it('does not warn when visit events carry an id', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const visit = { id: 'v-1', method: 'get', url: new URL('http://localhost/a'), only: [], except: [] }
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit }))

      const legacyWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('requires Inertia >= 3.4'))
      expect(legacyWarnings).toHaveLength(0)
      warnSpy.mockRestore()
    })
  })

  describe('prefetch via DOM events', () => {
    it('creates prefetch record only after start confirms real request', () => {
      const visit = {
        id: 'visit-prefetch-1',
        method: 'get',
        url: new URL('http://localhost/prefetched'),
        only: [],
        except: [],
        prefetch: true,
      }

      // before alone (cache hit) should NOT create a record
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit }))
      expect(store.getState().requests).toHaveLength(0)

      // start confirms real request → record created
      store.captureEvent('inertia:start', makeCustomEvent('inertia:start', { visit }))
      const state = store.getState()
      expect(state.requests).toHaveLength(1)
      expect(state.requests[0].type).toBe('prefetch')
    })
  })

  describe('subscription', () => {
    it('notifies subscribers on state change', () => {
      const subscriber = vi.fn()
      store.subscribe(subscriber)
      store.setPanelOpen(true)

      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      // Called once for setPanelOpen + once for captureEvent
      expect(subscriber).toHaveBeenCalled()
      const lastCallState = subscriber.mock.calls[subscriber.mock.calls.length - 1][0]
      expect(lastCallState.requests).toHaveLength(1)
    })

    it('returns unsubscribe function', () => {
      const subscriber = vi.fn()
      const unsub = store.subscribe(subscriber)

      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      const callCountBefore = subscriber.mock.calls.length
      unsub()

      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test2'), only: [], except: [] },
        }),
      )

      expect(subscriber.mock.calls.length).toBe(callCountBefore)
    })

    it('swallows subscriber errors', () => {
      store.subscribe(() => {
        throw new Error('subscriber crash')
      })

      // Should not throw
      expect(() => {
        store.captureEvent(
          'inertia:before',
          makeCustomEvent('inertia:before', {
            visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
          }),
        )
      }).not.toThrow()
    })
  })

  describe('clear', () => {
    it('clears all state', () => {
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      store.clear()

      const state = store.getState()
      expect(state.requests).toHaveLength(0)
    })
  })

  describe('panel state', () => {
    it('tracks panel open/closed state', () => {
      expect(store.isPanelOpen()).toBe(false)
      store.setPanelOpen(true)
      expect(store.isPanelOpen()).toBe(true)
      store.setPanelOpen(false)
      expect(store.isPanelOpen()).toBe(false)
    })
  })

  describe('getRequest', () => {
    it('returns a request by visitId', () => {
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      const request = store.getRequest(1)
      expect(request).toBeDefined()
      expect(request!.url).toContain('/test')
    })

    it('returns undefined for non-existent visitId', () => {
      expect(store.getRequest(999)).toBeUndefined()
    })
  })

  describe('notifications', () => {
    it('notifies subscribers even when panel is closed', () => {
      const subscriber = vi.fn()
      store.subscribe(subscriber)

      // Panel is closed by default — notifications should still fire
      // so the trigger icon can animate
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      expect(subscriber).toHaveBeenCalledTimes(1)
      expect(subscriber.mock.calls[0][0].requests).toHaveLength(1)
    })
  })

  describe('eviction counting', () => {
    it('tracks evicted count from correlator', () => {
      // evictedCount starts at 0
      expect(store.evictedCount).toBe(0)

      // With the default correlator maxRecords (200), no eviction
      // happens with a small number of events
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )
      expect(store.evictedCount).toBe(0)
    })
  })
})
