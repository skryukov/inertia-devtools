import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevToolsStore } from './store'

function makeCustomEvent(name: string, detail: unknown = {}): CustomEvent {
  return new CustomEvent(name, { detail })
}

let visitSeq = 0
function makeVisit(over: Record<string, unknown> = {}) {
  return { id: `v-${++visitSeq}`, method: 'get', url: new URL('http://localhost/x'), completed: false, ...over }
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

    it('finalizes a prevented inertia:before as a prevented record', () => {
      const visit = { id: 'v-prev', method: 'get', url: new URL('http://localhost/danger'), only: [], except: [] }
      const event = new CustomEvent('inertia:before', { cancelable: true, detail: { visit } })
      event.preventDefault()

      store.captureEvent('inertia:before', event)

      const [record] = store.getState().requests
      expect(record.prevented).toBe(true)
      expect(record.completed).toBe(false)
      expect(record.finishedAt).toBe(record.startedAt)
    })
  })

  describe('legacy Inertia warning', () => {
    it('warns once when visit events carry no id (pre-3.4)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const legacyVisit = { method: 'get', url: new URL('http://localhost/a'), only: [], except: [] }
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: legacyVisit }))
      store.captureEvent('inertia:start', makeCustomEvent('inertia:start', { visit: legacyVisit }))

      const legacyWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('carry no visit id'))
      expect(legacyWarnings).toHaveLength(1)
      warnSpy.mockRestore()
    })

    it('does not warn when visit events carry an id', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const visit = { id: 'v-1', method: 'get', url: new URL('http://localhost/a'), only: [], except: [] }
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit }))

      const legacyWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('carry no visit id'))
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
          visit: { id: 'v-t1', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
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
          visit: { id: 'v-t2', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )

      const callCountBefore = subscriber.mock.calls.length
      unsub()

      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { id: 'v-t3', method: 'get', url: new URL('http://localhost/test2'), only: [], except: [] },
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
            visit: { id: 'v-t4', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
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
          visit: { id: 'v-t5', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
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
          visit: { id: 'v-t6', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
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
          visit: { id: 'v-t7', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
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
          visit: { id: 'v-t8', method: 'get', url: new URL('http://localhost/test'), only: [], except: [] },
        }),
      )
      expect(store.evictedCount).toBe(0)
    })
  })

  describe('deep page props', () => {
    it('captures page props beyond the clone depth cap intact', () => {
      // 14 levels deep — past MAX_CLONE_DEPTH; page objects use structuredClone
      let deep: Record<string, unknown> = { leaf: 'value' }
      for (let i = 0; i < 14; i++) deep = { nested: deep }

      store.captureEvent(
        'inertia:navigate',
        makeCustomEvent('inertia:navigate', {
          page: { component: 'Deep', url: '/deep', version: '1', props: deep, flash: {} },
          visitId: 'v-deep',
        }),
      )

      let node: unknown = store.requests[0].page!.props
      for (let i = 0; i < 14; i++) node = (node as Record<string, unknown>).nested
      expect((node as Record<string, unknown>).leaf).toBe('value')
    })
  })

  describe('router actions', () => {
    function makeRouter() {
      return { visit: vi.fn(), reload: vi.fn() }
    }

    function captureVisit(target: DevToolsStore, method: string, extra: Record<string, unknown> = {}) {
      target.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { id: `v-${method}`, method, url: new URL('http://localhost/users'), only: [], except: [], ...extra },
        }),
      )
    }

    it('canAct is true only when a router was provided', () => {
      expect(store.canAct).toBe(false)
      expect(new DevToolsStore({ router: makeRouter() }).canAct).toBe(true)
    })

    it('replayVisit re-issues a GET record with url/only/except', () => {
      const router = makeRouter()
      const actingStore = new DevToolsStore({ router })
      captureVisit(actingStore, 'get', { only: ['users'], except: ['stats'] })

      actingStore.replayVisit(actingStore.requests[0].visitId)

      expect(router.visit).toHaveBeenCalledTimes(1)
      // Path, not the absolute url this used to assert: `record.url` now keeps
      // the same shape Inertia itself uses, so a replayed visit is indistinguishable
      // from the original.
      expect(router.visit).toHaveBeenCalledWith('/users', {
        method: 'get',
        only: ['users'],
        except: ['stats'],
        headers: undefined,
      })
    })

    it('replayVisit refuses non-GET records', () => {
      const router = makeRouter()
      const actingStore = new DevToolsStore({ router })
      captureVisit(actingStore, 'post')

      actingStore.replayVisit(actingStore.requests[0].visitId)

      expect(router.visit).not.toHaveBeenCalled()
    })

    it('replayVisit ignores unknown visitIds', () => {
      const router = makeRouter()
      const actingStore = new DevToolsStore({ router })

      actingStore.replayVisit(999)

      expect(router.visit).not.toHaveBeenCalled()
    })

    it('reload delegates to the router', () => {
      const router = makeRouter()
      const actingStore = new DevToolsStore({ router })

      actingStore.reload()

      expect(router.reload).toHaveBeenCalledTimes(1)
      expect(router.reload).toHaveBeenCalledWith({})
    })

    it('no-ops without a router', () => {
      captureVisit(store, 'get')

      expect(() => {
        store.replayVisit(store.requests[0].visitId)
        store.reload()
      }).not.toThrow()
    })

    it('never lets a throwing router crash the host', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const router = {
        visit: vi.fn(() => {
          throw new Error('visit crash')
        }),
        reload: vi.fn(() => {
          throw new Error('reload crash')
        }),
      }
      const actingStore = new DevToolsStore({ router })
      captureVisit(actingStore, 'get')

      expect(() => {
        actingStore.replayVisit(actingStore.requests[0].visitId)
        actingStore.reload()
      }).not.toThrow()
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Replay failed'))).toBe(true)
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Reload failed'))).toBe(true)
      warnSpy.mockRestore()
    })
  })

  describe('store -> correlator seam', () => {
    // Every correlator test hands `processEvent` a hand-built CapturedEvent,
    // so none of them sees what the store actually produces. safeClone
    // stringifies visit.url to an ABSOLUTE url before the correlator ever
    // looks at it, which is why `record.url` was "http://localhost/users" in
    // production while 108 correlator tests asserted "/users".
    it('records a path-shaped url even though the store stringifies the URL object', () => {
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { id: 'v-seam', method: 'get', url: new URL('http://localhost/users?page=2'), only: [], except: [] },
        }),
      )
      const record = store.getState().requests.at(-1)!
      expect(record.url).toBe('/users?page=2')
      expect(record.url).not.toContain('http://')
    })

    it('masks credentials the visit detail carried into the raw events', () => {
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: {
            id: 'v-secret',
            method: 'post',
            url: new URL('http://localhost/login'),
            only: [],
            except: [],
            data: { email: 'ada@example.com', password: 'hunter2' },
            headers: { Authorization: 'Bearer JWT', 'X-Inertia': 'true' },
          },
        }),
      )
      const serialized = JSON.stringify(store.getState().requests.at(-1))
      expect(serialized).not.toContain('hunter2')
      expect(serialized).not.toContain('Bearer JWT')
      // Non-sensitive fields survive so the record stays debuggable.
      expect(serialized).toContain('ada@example.com')
      expect(serialized).toContain('X-Inertia')
    })
  })

  describe('flushPendingSave', () => {
    it('saves the session immediately instead of waiting for the debounce', () => {
      sessionStorage.clear()
      store.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', {
          visit: { id: 'v-flush', method: 'get', url: new URL('http://localhost/users'), only: [], except: [] },
        }),
      )
      // Debounced save has not fired yet
      expect(sessionStorage.getItem('inertia-devtools-session')).toBeNull()

      store.flushPendingSave()
      const raw = sessionStorage.getItem('inertia-devtools-session')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw!).requests).toHaveLength(1)
    })

    it('is a no-op when no save is pending', () => {
      sessionStorage.clear()
      store.flushPendingSave()
      expect(sessionStorage.getItem('inertia-devtools-session')).toBeNull()
    })
  })

  describe('real capture path (U3 through captureEvent, not processEvent)', () => {
    // Round 3 B14: 312 correlator tests call processEvent directly and ZERO go
    // through captureEvent — so they exercise a branch production never takes
    // (already-stringified detail, no safeSerializeDetail). This routes the U3
    // scenario through the true entry point, so the misattribution fix is
    // verified on the path that actually ships.
    it('a network error lands on the click visit, not the in-flight prefetch', () => {
      const click = makeVisit({ method: 'post', url: new URL('http://localhost/save') })
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: click }))
      const prefetch = makeVisit({ prefetch: true, url: new URL('http://localhost/next') })
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: prefetch }))
      store.captureEvent('inertia:start', makeCustomEvent('inertia:start', { visit: prefetch }))

      store.captureEvent('inertia:networkError', makeCustomEvent('inertia:networkError', { error: new Error('boom') }))

      const rows = store.getState().requests
      expect(rows.find((r) => r.url === '/save')!.failed).toBe(true)
      expect(rows.find((r) => r.url === '/next')!.failed).toBeUndefined()
    })
  })
})
