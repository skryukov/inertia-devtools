import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevToolsStore } from './store'
import { createInRealmClient } from './client'
import type { SessionSnapshot } from './types'

function makeCustomEvent(name: string, detail: unknown = {}): CustomEvent {
  return new CustomEvent(name, { detail })
}

function makeVisit(id: string, path = '/test') {
  return { id, method: 'get', url: new URL(`http://localhost${path}`), only: [], except: [] }
}

describe('createInRealmClient', () => {
  let store: DevToolsStore

  beforeEach(() => {
    sessionStorage.clear()
    store = new DevToolsStore()
  })

  describe('hello config', () => {
    it('carries the default docs provider', () => {
      const client = createInRealmClient(store)
      expect(client.hello.docsProvider).toBe('inertiajs')
    })

    it('carries the configured docs provider', () => {
      const client = createInRealmClient(new DevToolsStore({ docsProvider: 'inertia-rails' }))
      expect(client.hello.docsProvider).toBe('inertia-rails')
    })

    it('carries previous-session requests loaded by the store', () => {
      const snapshot: SessionSnapshot = {
        savedAt: Date.now(),
        requests: [
          {
            visitId: 1,
            type: 'full',
            method: 'GET',
            url: 'http://localhost/users',
            startedAt: 0,
            completed: true,
            cancelled: false,
            interrupted: false,
            featureTypes: [],
            hasErrors: false,
            diagnostics: [],
          },
        ],
      }
      sessionStorage.setItem('inertia-devtools-session', JSON.stringify(snapshot))

      const client = createInRealmClient(new DevToolsStore())
      expect(client.hello.previousSessionRequests).toHaveLength(1)
      expect(client.hello.previousSessionRequests[0].url).toBe('http://localhost/users')
    })

    it('carries an empty list when no previous session exists', () => {
      const client = createInRealmClient(store)
      expect(client.hello.previousSessionRequests).toEqual([])
    })

    it('carries canAct: false when no router was provided', () => {
      const client = createInRealmClient(store)
      expect(client.hello.canAct).toBe(false)
    })

    it('carries canAct: true when the store has a router', () => {
      const router = { visit: vi.fn(), reload: vi.fn() }
      const client = createInRealmClient(new DevToolsStore({ router }))
      expect(client.hello.canAct).toBe(true)
    })
  })

  describe('state', () => {
    it('getState reflects the current store state', () => {
      const client = createInRealmClient(store)
      expect(client.getState().requests).toEqual([])

      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-1') }))

      const state = client.getState()
      expect(state.requests).toHaveLength(1)
      expect(state.requests[0].method).toBe('GET')
      expect(state).toEqual(store.getState())
    })
  })

  describe('subscription', () => {
    it('forwards store notifications with the state snapshot', () => {
      const client = createInRealmClient(store)
      const subscriber = vi.fn()
      client.subscribe(subscriber)

      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-2') }))

      expect(subscriber).toHaveBeenCalledTimes(1)
      expect(subscriber.mock.calls[0][0].requests).toHaveLength(1)
    })

    it('stops notifying after unsubscribe', () => {
      const client = createInRealmClient(store)
      const subscriber = vi.fn()
      const unsub = client.subscribe(subscriber)

      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-3') }))
      const callCountBefore = subscriber.mock.calls.length
      unsub()

      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-4', '/other') }))

      expect(subscriber.mock.calls.length).toBe(callCountBefore)
    })
  })

  describe('commands', () => {
    it('clear() proxies to the store', () => {
      const client = createInRealmClient(store)
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-5') }))
      expect(client.getState().requests).toHaveLength(1)

      client.clear()

      expect(client.getState().requests).toHaveLength(0)
    })

    it('setPanelOpen() proxies to the store', () => {
      const client = createInRealmClient(store)

      client.setPanelOpen(true)
      expect(store.isPanelOpen()).toBe(true)

      client.setPanelOpen(false)
      expect(store.isPanelOpen()).toBe(false)
    })

    it('replayVisit() proxies to the store, which drives the router', () => {
      const router = { visit: vi.fn(), reload: vi.fn() }
      const actingStore = new DevToolsStore({ router })
      const client = createInRealmClient(actingStore)
      actingStore.captureEvent(
        'inertia:before',
        makeCustomEvent('inertia:before', { visit: makeVisit('v-6', '/replay') }),
      )

      client.replayVisit(client.getState().requests[0].visitId)

      expect(router.visit).toHaveBeenCalledTimes(1)
      // Path, not the absolute url — see the store -> correlator seam tests.
      expect(router.visit).toHaveBeenCalledWith('/replay', expect.objectContaining({ method: 'get' }))
    })

    it('reload() proxies to the store, which drives the router', () => {
      const router = { visit: vi.fn(), reload: vi.fn() }
      const client = createInRealmClient(new DevToolsStore({ router }))

      client.reload()

      expect(router.reload).toHaveBeenCalledTimes(1)
    })

    it('replayVisit() and reload() are safe no-ops without a router', () => {
      const client = createInRealmClient(store)
      store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-7') }))

      expect(() => {
        client.replayVisit(client.getState().requests[0].visitId)
        client.reload()
      }).not.toThrow()
    })
  })
})
