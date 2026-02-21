import { describe, it, expect, beforeEach } from 'vitest'
import { Correlator } from './correlator'
import type { CapturedEvent } from './types'
import type { InertiaPage, InertiaEventName } from './protocol'
import type { NetworkTiming } from './network'

let eventId = 0

function makeTiming(overrides: Partial<NetworkTiming> = {}): NetworkTiming {
  return {
    url: 'http://localhost/users',
    startedAt: 105,
    finishedAt: 140,
    duration: 35,
    ...overrides,
  }
}

function makeEvent(name: InertiaEventName, detail: Record<string, unknown> = {}, timestamp?: number): CapturedEvent {
  return {
    id: ++eventId,
    name,
    timestamp: timestamp ?? performance.now(),
    detail,
  }
}

function makeVisitObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'get',
    url: new URL('http://localhost/users'),
    completed: false,
    cancelled: false,
    interrupted: false,
    only: [],
    except: [],
    prefetch: false,
    ...overrides,
  }
}

function makePage(overrides: Partial<InertiaPage> = {}): InertiaPage {
  return {
    component: 'Pages/Users/Index',
    props: { users: [] },
    url: '/users',
    version: 'abc123',
    clearHistory: false,
    encryptHistory: false,
    flash: {},
    ...overrides,
  }
}

describe('Correlator', () => {
  let correlator: Correlator

  beforeEach(() => {
    correlator = new Correlator()
    eventId = 0
  })

  describe('basic request lifecycle', () => {
    it('creates a RequestRecord on inertia:before', () => {
      const visit = makeVisitObject()
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record).not.toBeNull()
      expect(record!.visitId).toBe(1)
      expect(record!.method).toBe('GET')
      expect(record!.url).toBe('/users')
      expect(record!.type).toBe('full')
      expect(record!.cancelled).toBe(false)
      expect(record!.events).toHaveLength(1)
    })

    it('correlates start and finish via WeakMap', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 102))
      const record = correlator.processEvent(
        makeEvent(
          'inertia:finish',
          {
            visit: { ...visit, completed: true },
          },
          145,
        ),
      )

      // WeakMap miss for spread copy, falls back to active visit ID
      expect(record).not.toBeNull()
      expect(record!.events).toHaveLength(3)
    })

    it('correlates start and finish with same object reference via WeakMap', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 102))

      // Simulate finish with the same visit object (as Inertia does)
      Object.assign(visit, { completed: true })
      const record = correlator.processEvent(makeEvent('inertia:finish', { visit }, 145))

      expect(record).not.toBeNull()
      expect(record!.events).toHaveLength(3)
      expect(record!.finishedAt).toBe(145)
      expect(record!.duration).toBe(45)
      expect(record!.completed).toBe(true)
    })

    it('attaches page on navigate event', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 146))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].page).toEqual(page)
    })

    it('tracks current page', () => {
      const visit = makeVisitObject()
      const page = makePage()

      expect(correlator.getCurrentPage()).toBeNull()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 146))

      expect(correlator.getCurrentPage()).toEqual(page)
    })
  })

  describe('visit type classification', () => {
    it('classifies partial reload (only)', () => {
      const visit = makeVisitObject({ only: ['users', 'roles'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('partial')
    })

    it('classifies partial reload (except)', () => {
      const visit = makeVisitObject({ except: ['largeProp'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('partial')
    })

    it('defers prefetch record creation until start event', () => {
      const visit = makeVisitObject({ prefetch: true })

      // before alone returns null (deferred)
      const beforeResult = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      expect(beforeResult).toBeNull()
      expect(correlator.getRequests()).toHaveLength(0)

      // start confirms real request → creates prefetch record
      const startResult = correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      expect(startResult!.type).toBe('prefetch')
      expect(correlator.getRequests()).toHaveLength(1)
    })

    it('defaults to full visit', () => {
      const visit = makeVisitObject()
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('full')
    })
  })

  describe('cancelled visits', () => {
    it('marks visit as cancelled on cancel event', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:cancel', {}, 105))

      const requests = correlator.getRequests()
      expect(requests[0].cancelled).toBe(true)
    })
  })

  describe('error events', () => {
    it('captures validation errors', () => {
      const visit = makeVisitObject()
      const errors = { name: 'Name is required', email: 'Invalid email' }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:error', { errors }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].error).toEqual(errors)
    })

    it('captures exception', () => {
      const visit = makeVisitObject()
      const exception = new Error('Network error')

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:exception', { exception }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].error).toBe(exception)
    })

    it('captures invalid response status', () => {
      const visit = makeVisitObject()
      const response = { status: 500, data: '<html>Error</html>' }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:invalid', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].status).toBe(500)
    })

    it('detects 409 redirect with X-Inertia-Location', () => {
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const response = {
        status: 409,
        headers: { 'x-inertia-location': '/posts/1' },
      }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:invalid', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].type).toBe('redirect')
      expect(requests[0].status).toBe(409)
      expect(requests[0].redirectUrl).toBe('/posts/1')
    })

    it('detects 409 redirect without headers', () => {
      const visit = makeVisitObject()
      const response = { status: 409 }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:invalid', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].type).toBe('redirect')
      expect(requests[0].redirectUrl).toBeUndefined()
    })

    // v3 event names
    it('captures networkError (v3 exception)', () => {
      const visit = makeVisitObject()
      const exception = new Error('Network error')

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:networkError', { exception }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].error).toBe(exception)
    })

    it('captures httpException status (v3 invalid)', () => {
      const visit = makeVisitObject()
      const response = { status: 500, data: '<html>Error</html>' }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].status).toBe(500)
    })

    it('detects 409 redirect via x-inertia-redirect (v3)', () => {
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const response = {
        status: 409,
        headers: { 'x-inertia-redirect': '/posts/1' },
      }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].type).toBe('redirect')
      expect(requests[0].status).toBe(409)
      expect(requests[0].redirectUrl).toBe('/posts/1')
    })
  })

  describe('feature extraction', () => {
    it('detects encrypted history', () => {
      const visit = makeVisitObject()
      const page = makePage({ encryptHistory: true })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const features = requests[0].features
      expect(features.some((f) => f.type === 'encrypted')).toBe(true)
    })

    it('detects deferred props', () => {
      const visit = makeVisitObject()
      const page = makePage({
        deferredProps: { default: ['comments', 'reactions'] },
      })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const deferred = requests[0].features.find((f) => f.type === 'deferred')
      expect(deferred).toBeDefined()
      expect(deferred!.details!.groups).toEqual({ default: ['comments', 'reactions'] })
    })

    it('detects merge strategies', () => {
      const visit = makeVisitObject()
      const page = makePage({
        mergeProps: ['posts'],
        deepMergeProps: ['config'],
      })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const features = requests[0].features
      expect(features.some((f) => f.type === 'merge')).toBe(true)
      expect(features.some((f) => f.type === 'deep-merge')).toBe(true)
    })

    it('detects flash data', () => {
      const visit = makeVisitObject()
      const page = makePage({ flash: { notice: 'Created!' } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const flash = requests[0].features.find((f) => f.type === 'flash')
      expect(flash).toBeDefined()
    })

    it('detects remembered state', () => {
      const visit = makeVisitObject()
      const page = makePage({
        rememberedState: { scrollPosition: 100, formData: { name: 'Alice' } },
      })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const remember = requests[0].features.find((f) => f.type === 'remember')
      expect(remember).toBeDefined()
      expect(remember!.label).toBe('REMEMBER')
      expect(remember!.details!.keys).toEqual(['scrollPosition', 'formData'])
    })

    it('does not detect remember when rememberedState is empty', () => {
      const visit = makeVisitObject()
      const page = makePage({ rememberedState: {} })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].features.some((f) => f.type === 'remember')).toBe(false)
    })

    it('detects cached prefetch (navigation without start/finish)', () => {
      const visit = makeVisitObject()

      // before fires, then navigate fires immediately (no start/finish = cache hit)
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 102))

      const requests = correlator.getRequests()
      const cached = requests[0].features.find((f) => f.type === 'cached')
      expect(cached).toBeDefined()
      expect(cached!.label).toBe('CACHED')
    })

    it('does not detect cached for normal requests with start/finish', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 145))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 146))

      const requests = correlator.getRequests()
      expect(requests[0].features.some((f) => f.type === 'cached')).toBe(false)
    })

    it('does not detect cached for initial page load synthetic record', () => {
      // Initial page load: navigate fires with no preceding before/start
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 50))

      const requests = correlator.getRequests()
      // Synthetic record has startedAt=0, should NOT be marked as cached
      expect(requests[0].features.some((f) => f.type === 'cached')).toBe(false)
    })

    it('detects partial reload', () => {
      const visit = makeVisitObject({ only: ['users'] })
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const requests = correlator.getRequests()
      const partial = requests[0].features.find((f) => f.type === 'partial')
      expect(partial).toBeDefined()
    })
  })

  describe('prefetch events', () => {
    it('does not create record for cached prefetch (before only, no start)', () => {
      const visit = makeVisitObject({ prefetch: true })

      // Cache hit: only before fires, no start follows
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(correlator.getRequests()).toHaveLength(0)
    })

    it('creates prefetch record when start confirms real request', () => {
      const visit = makeVisitObject({ prefetch: true })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].type).toBe('prefetch')
      expect(requests[0].events).toHaveLength(2) // before + start
      expect(requests[0].features.some((f) => f.type === 'prefetch')).toBe(true)
    })

    it('completes prefetch record on finish', () => {
      const visit = makeVisitObject({ prefetch: true })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 200))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].duration).toBe(100)
      expect(requests[0].completed).toBe(true)
    })

    it('creates exactly one record per real prefetch request', () => {
      const visit = makeVisitObject({ prefetch: true, url: new URL('http://localhost/page') })

      // Full lifecycle: before → start → finish
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 200))

      // Only 1 record, not 2
      expect(correlator.getRequests()).toHaveLength(1)
    })
  })

  describe('POST redirect (beforeUpdate page extraction)', () => {
    it('extracts page from beforeUpdate when navigate does not fire', () => {
      // POST→302→GET: navigate never fires (replace=true in Inertia client)
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const page = makePage({
        component: 'Pages/Posts/Index',
        url: '/posts',
        flash: { notice: 'Created!' },
      })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))
      correlator.processEvent(makeEvent('inertia:flash', {}, 111))
      correlator.processEvent(makeEvent('inertia:success', {}, 112))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 113))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].page).toBeDefined()
      expect(requests[0].page!.component).toBe('Pages/Posts/Index')
      expect(requests[0].features.some((f) => f.type === 'flash')).toBe(true)
    })

    it('does not overwrite page set by navigate', () => {
      // Normal flow: beforeUpdate fires first, then navigate
      const visit = makeVisitObject()
      const beforeUpdatePage = makePage({ props: { partial: true } })
      const navigatePage = makePage({ props: { full: true } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: beforeUpdatePage }, 110))
      correlator.processEvent(makeEvent('inertia:navigate', { page: navigatePage }, 115))

      const requests = correlator.getRequests()
      // beforeUpdate sets page first; navigate should overwrite it
      expect(requests[0].page!.props).toEqual({ full: true })
    })

    it('updates lastPage from beforeUpdate for correct previousPage on next request', () => {
      const visit1 = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const page1 = makePage({ component: 'Pages/Posts/Index', url: '/posts' })

      correlator.processEvent(makeEvent('inertia:before', { visit: visit1 }, 100))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: page1 }, 110))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit1, completed: true } }, 115))

      const visit2 = makeVisitObject({ url: new URL('http://localhost/users') })
      correlator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 200))

      const requests = correlator.getRequests()
      expect(requests[1].previousPage).toEqual(page1)
    })
  })

  describe('multiple requests', () => {
    it('handles sequential requests', () => {
      const visit1 = makeVisitObject()
      const visit2 = makeVisitObject({ url: new URL('http://localhost/posts') })

      correlator.processEvent(makeEvent('inertia:before', { visit: visit1 }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 145))

      correlator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage({ url: '/posts' }) }, 245))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(2)
      expect(requests[0].url).toBe('/users')
      expect(requests[1].url).toBe('/posts')
    })

    it('stores previousPage for diff computation', () => {
      const visit1 = makeVisitObject()
      const page1 = makePage({ props: { users: ['Alice'] } })
      const visit2 = makeVisitObject({ url: new URL('http://localhost/users/1') })
      const page2 = makePage({ url: '/users/1', props: { user: { name: 'Alice' } } })

      correlator.processEvent(makeEvent('inertia:before', { visit: visit1 }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: page1 }, 145))

      correlator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: page2 }, 245))

      const requests = correlator.getRequests()
      expect(requests[1].previousPage).toEqual(page1)
    })
  })

  describe('clear', () => {
    it('resets records but preserves current page', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      correlator.clear()

      expect(correlator.getRequests()).toHaveLength(0)
      expect(correlator.getCurrentPage()).toEqual(page)
    })

    it('resets visitId counter', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      correlator.clear()

      const visit2 = makeVisitObject()
      const record = correlator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 200))
      expect(record!.visitId).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('creates synthetic record for navigate without active visit (initial page load)', () => {
      const result = correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 100))
      // Initial page load creates a synthetic record
      expect(result).not.toBeNull()
      expect(result!.type).toBe('full')
      expect(result!.completed).toBe(true)
      expect(correlator.getCurrentPage()).not.toBeNull()
    })

    it('handles before event without visit detail', () => {
      const record = correlator.processEvent(makeEvent('inertia:before', {}, 100))
      expect(record).not.toBeNull()
      expect(record!.url).toBe('(unknown)')
      expect(record!.method).toBe('GET')
    })

    it('assigns monotonically increasing visit IDs', () => {
      for (let i = 0; i < 5; i++) {
        correlator.processEvent(makeEvent('inertia:before', { visit: makeVisitObject() }, i * 100))
      }
      const requests = correlator.getRequests()
      const ids = requests.map((r) => r.visitId)
      expect(ids).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('deferred prop reloads', () => {
    it('classifies deferred reload and sets parentVisitId', () => {
      const visit = makeVisitObject()
      const page = makePage({ deferredProps: { default: ['comments'] } })

      // Parent visit: full navigation
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      // Deferred reload
      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['comments'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))

      expect(record).not.toBeNull()
      expect(record!.type).toBe('deferred')
      expect(record!.parentVisitId).toBe(1)
    })

    it('does not steal activeVisitId from parent', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      // Deferred reload starts
      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))

      // Navigate event should still go to parent (visit 1), not the deferred record
      const updatedPage = makePage({ props: { users: [], sidebar: 'loaded' } })
      const navRecord = correlator.processEvent(makeEvent('inertia:navigate', { page: updatedPage }, 160))

      expect(navRecord!.visitId).toBe(1)
      expect(navRecord!.page).toEqual(updatedPage)
    })

    it('captures page data from lastPage on finish for props diff', () => {
      const visit = makeVisitObject()
      const initialPage = makePage({ props: { users: [], comments: null } })

      // Parent visit
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 145))

      // Deferred reload
      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['comments'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))
      correlator.processEvent(makeEvent('inertia:start', { visit: deferredVisit }, 151))

      // Server responds; beforeUpdate/navigate update lastPage (go to parent)
      const mergedPage = makePage({ props: { users: [], comments: ['Great post!'] } })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: mergedPage }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: mergedPage }, 201))

      // Finish goes to deferred record via fingerprint
      const finishRecord = correlator.processEvent(
        makeEvent('inertia:finish', { visit: { ...deferredVisit, completed: true } }, 202),
      )

      expect(finishRecord).not.toBeNull()
      expect(finishRecord!.type).toBe('deferred')
      expect(finishRecord!.page).toEqual(mergedPage)
      expect(finishRecord!.previousPage).toEqual(initialPage)
    })

    it('sets previousPage to the page state before deferred load', () => {
      const visit = makeVisitObject()
      const initialPage = makePage({ props: { title: 'Hello' } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 145))

      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))

      // previousPage should be the page before the deferred request
      expect(record!.previousPage).toEqual(initialPage)
    })

    it('handles deferred before-events that fire before initial navigate', () => {
      // Real-world scenario: on initial page load, Inertia fires deferred
      // before/start events BEFORE the initial navigate event.
      const initialPage = makePage({
        props: { errors: {}, title: 'Demo' },
        deferredProps: { sidebar: ['sidebar'], default: ['comments'] },
      })

      // Sidebar deferred fires first (before any navigate!)
      const sidebarVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: sidebarVisit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: sidebarVisit }, 101))

      // Comments deferred fires next
      const commentsVisit = makeVisitObject({ deferredProps: true, only: ['comments'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: commentsVisit }, 102))
      correlator.processEvent(makeEvent('inertia:start', { visit: commentsVisit }, 103))

      // Initial navigate fires AFTER deferred before-events
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 110))

      const requests = correlator.getRequests()
      // Should have 3 records: initial page (startedAt=0), sidebar deferred, comments deferred
      expect(requests).toHaveLength(3)
      expect(requests[0].type).toBe('full')
      expect(requests[1].type).toBe('deferred')
      expect(requests[2].type).toBe('deferred')

      // Deferred records should be linked to the initial page record
      expect(requests[1].parentVisitId).toBe(requests[0].visitId)
      expect(requests[2].parentVisitId).toBe(requests[0].visitId)

      // Deferred records should have previousPage set from the initial page
      expect(requests[1].previousPage).toEqual(initialPage)
      expect(requests[2].previousPage).toEqual(initialPage)
    })

    it('shows props diff for deferred requests after initial page load', () => {
      const initialPage = makePage({
        props: { errors: {}, title: 'Demo' },
        deferredProps: { default: ['comments'] },
      })

      // Deferred before fires before navigate
      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['comments'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: deferredVisit }, 101))

      // Initial navigate
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 110))

      // Server responds with merged page
      const mergedPage = makePage({
        props: { errors: {}, title: 'Demo', comments: [{ id: 1, body: 'Hi' }] },
      })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: mergedPage }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: mergedPage }, 201))

      // Finish goes to deferred record via fingerprint
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...deferredVisit, completed: true } }, 202))

      const requests = correlator.getRequests()
      const deferred = requests.find((r) => r.type === 'deferred')!

      // Should have both page and previousPage for diff
      expect(deferred.page).toEqual(mergedPage)
      expect(deferred.previousPage).toEqual(initialPage)

      // previousPage has no comments, page has comments → diff should show the addition
      expect(deferred.previousPage!.props).not.toHaveProperty('comments')
      expect(deferred.page!.props).toHaveProperty('comments')
    })
  })

  describe('only/except capture', () => {
    it('captures only and except on RequestRecord', () => {
      const visit = makeVisitObject({ only: ['users', 'roles'], except: ['largeProp'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.only).toEqual(['users', 'roles'])
      expect(record!.except).toEqual(['largeProp'])
    })

    it('captures only on deferred records', () => {
      const visit = makeVisitObject()
      const page = makePage({ deferredProps: { sidebar: ['sidebar'] } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 145))

      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))

      expect(record!.only).toEqual(['sidebar'])
      expect(record!.type).toBe('deferred')
    })

    it('does not set only/except when arrays are empty', () => {
      const visit = makeVisitObject({ only: [], except: [] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.only).toBeUndefined()
      expect(record!.except).toBeUndefined()
    })

    it('captures only/except on prefetch records', () => {
      const visit = makeVisitObject({ prefetch: true, only: ['sidebar'] })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      const record = correlator.processEvent(makeEvent('inertia:start', { visit }, 101))

      expect(record!.only).toEqual(['sidebar'])
    })
  })

  describe('deferred previousPage fix', () => {
    it('shows correct previousPage for second deferred request (only its own changes)', () => {
      // Initial page with two deferred groups
      const initialPage = makePage({
        props: { errors: {}, title: 'Demo' },
        deferredProps: { sidebar: ['sidebar'], default: ['comments'] },
      })

      // Both deferred requests fire before navigate
      const sidebarVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: sidebarVisit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: sidebarVisit }, 101))

      const commentsVisit = makeVisitObject({ deferredProps: true, only: ['comments'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: commentsVisit }, 102))
      correlator.processEvent(makeEvent('inertia:start', { visit: commentsVisit }, 103))

      // Initial navigate
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 110))

      // Sidebar response arrives first
      const sidebarMergedPage = makePage({
        props: { errors: {}, title: 'Demo', sidebar: { items: ['nav1'] } },
        deferredProps: { default: ['comments'] },
      })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: sidebarMergedPage }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: sidebarMergedPage }, 201))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...sidebarVisit, completed: true } }, 202))

      // Comments response arrives second
      const commentsMergedPage = makePage({
        props: { errors: {}, title: 'Demo', sidebar: { items: ['nav1'] }, comments: ['Great!'] },
      })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: commentsMergedPage }, 300))
      correlator.processEvent(makeEvent('inertia:navigate', { page: commentsMergedPage }, 301))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...commentsVisit, completed: true } }, 302))

      const requests = correlator.getRequests()
      const sidebarRecord = requests.find((r) => r.type === 'deferred' && r.only?.includes('sidebar'))!
      const commentsRecord = requests.find((r) => r.type === 'deferred' && r.only?.includes('comments'))!

      // Sidebar: previousPage = initialPage (before sidebar merged)
      expect(sidebarRecord.previousPage).toEqual(initialPage)
      // Sidebar: page = sidebarMergedPage (after sidebar merged)
      expect(sidebarRecord.page).toEqual(sidebarMergedPage)

      // Comments: previousPage should be sidebarMergedPage (after sidebar but before comments)
      // NOT initialPage — that would incorrectly show sidebar as "added" in comments diff
      expect(commentsRecord.previousPage).toEqual(sidebarMergedPage)
      // Comments: page = commentsMergedPage (after comments merged)
      expect(commentsRecord.page).toEqual(commentsMergedPage)
    })
  })

  describe('initial page load', () => {
    it('creates a synthetic record when navigate fires with no active visit', () => {
      const page = makePage({ component: 'Pages/Home', url: '/home' })
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page }, 50))

      expect(record).not.toBeNull()
      expect(record!.type).toBe('full')
      expect(record!.method).toBe('GET')
      expect(record!.url).toBe('/home')
      expect(record!.page).toBe(page)
      expect(record!.completed).toBe(true)
      expect(record!.duration).toBe(0)
      expect(record!.events).toHaveLength(1)
      expect(record!.events[0].name).toBe('inertia:navigate')
    })

    it('does not create synthetic record if navigate follows a before', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      const page = makePage()
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page }, 150))

      expect(record).not.toBeNull()
      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1) // only one record, not two
    })

    it('sets currentPage from initial navigate', () => {
      const page = makePage({ component: 'Pages/Landing' })
      correlator.processEvent(makeEvent('inertia:navigate', { page }, 50))
      expect(correlator.getCurrentPage()?.component).toBe('Pages/Landing')
    })
  })

  describe('record eviction', () => {
    it('evicts oldest completed record when over capacity', () => {
      const smallCorrelator = new Correlator(3)

      // Create 3 completed records
      for (let i = 0; i < 3; i++) {
        const visit = makeVisitObject({ url: new URL(`http://localhost/page${i}`) })
        smallCorrelator.processEvent(makeEvent('inertia:before', { visit }, i * 100))
        smallCorrelator.processEvent(
          makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, i * 100 + 50),
        )
      }
      expect(smallCorrelator.getRequests()).toHaveLength(3)

      // 4th record should trigger eviction of the oldest completed
      const visit4 = makeVisitObject({ url: new URL('http://localhost/page3') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit4 }, 400))

      const requests = smallCorrelator.getRequests()
      expect(requests).toHaveLength(3)
      // First record (/page0) was evicted
      expect(requests[0].url).toBe('/page1')
    })

    it('evicts oldest in-flight record when no completed records exist', () => {
      const smallCorrelator = new Correlator(2)

      // Create 2 in-flight records (no finish)
      for (let i = 0; i < 2; i++) {
        const visit = makeVisitObject({ url: new URL(`http://localhost/page${i}`) })
        smallCorrelator.processEvent(makeEvent('inertia:before', { visit }, i * 100))
      }
      expect(smallCorrelator.getRequests()).toHaveLength(2)

      // 3rd record triggers eviction — no completed records, so oldest is evicted
      const visit3 = makeVisitObject({ url: new URL('http://localhost/page2') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit3 }, 300))

      const requests = smallCorrelator.getRequests()
      expect(requests).toHaveLength(2)
      expect(requests[0].url).toBe('/page1')
    })

    it('prefers evicting completed records over in-flight ones', () => {
      const smallCorrelator = new Correlator(3)

      // Record 0: in-flight
      const visit0 = makeVisitObject({ url: new URL('http://localhost/inflight') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit0 }, 100))

      // Record 1: completed
      const visit1 = makeVisitObject({ url: new URL('http://localhost/done') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit1 }, 200))
      smallCorrelator.processEvent(makeEvent('inertia:finish', { visit: { ...visit1, completed: true } }, 250))

      // Record 2: in-flight
      const visit2 = makeVisitObject({ url: new URL('http://localhost/inflight2') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 300))

      expect(smallCorrelator.getRequests()).toHaveLength(3)

      // 4th record triggers eviction — should evict /done (completed), not /inflight
      const visit3 = makeVisitObject({ url: new URL('http://localhost/new') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit3 }, 400))

      const urls = smallCorrelator.getRequests().map((r) => r.url)
      expect(urls).toContain('/inflight')
      expect(urls).toContain('/inflight2')
      expect(urls).not.toContain('/done')
      expect(urls).toContain('/new')
    })

    it('evicted records are removed from getRequest lookup', () => {
      const smallCorrelator = new Correlator(2)

      const visit0 = makeVisitObject({ url: new URL('http://localhost/page0') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit0 }, 100))
      smallCorrelator.processEvent(makeEvent('inertia:finish', { visit: { ...visit0, completed: true } }, 150))

      const visit1 = makeVisitObject({ url: new URL('http://localhost/page1') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit1 }, 200))

      // Visit 1 exists
      expect(smallCorrelator.getRequest(1)).toBeDefined()

      // 3rd record triggers eviction of visit 1
      const visit2 = makeVisitObject({ url: new URL('http://localhost/page2') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visit2 }, 300))

      expect(smallCorrelator.getRequest(1)).toBeUndefined()
    })

    it('maintains sorted order after eviction', () => {
      const smallCorrelator = new Correlator(3)

      for (let i = 0; i < 5; i++) {
        const visit = makeVisitObject({ url: new URL(`http://localhost/page${i}`) })
        smallCorrelator.processEvent(makeEvent('inertia:before', { visit }, i * 100))
        smallCorrelator.processEvent(
          makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, i * 100 + 50),
        )
      }

      const requests = smallCorrelator.getRequests()
      expect(requests).toHaveLength(3)
      // Should be sorted by startedAt
      for (let i = 1; i < requests.length; i++) {
        expect(requests[i].startedAt).toBeGreaterThanOrEqual(requests[i - 1].startedAt)
      }
    })
  })

  describe('getRequest', () => {
    it('returns record by visitId', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(correlator.getRequest(1)).toBeDefined()
      expect(correlator.getRequest(1)!.url).toBe('/users')
    })

    it('returns undefined for non-existent visitId', () => {
      expect(correlator.getRequest(999)).toBeUndefined()
    })
  })

  describe('network timing correlation', () => {
    it('matches timing to visit by URL and timing', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      const timing = makeTiming({ startedAt: 105, finishedAt: 140 })
      const result = correlator.linkNetworkTiming(timing)

      expect(result).not.toBeNull()
      expect(result!.network).toBe(timing)
    })

    it('buffers unmatched timing entries for late correlation', () => {
      // Timing arrives before visit is created
      const timing = makeTiming({ startedAt: 100, finishedAt: 140 })
      const result = correlator.linkNetworkTiming(timing)
      expect(result).toBeNull()

      // Now create the visit
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))

      // Finish triggers drainPendingNetwork
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].network).toBe(timing)
    })

    it('does not crash on unmatched entries', () => {
      const timing = makeTiming({ url: 'http://localhost/no-match' })
      expect(() => correlator.linkNetworkTiming(timing)).not.toThrow()
    })

    it('matches by pathname, ignoring host differences', () => {
      const visit = makeVisitObject({ url: new URL('http://localhost/users') })
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      const timing = makeTiming({
        url: 'http://example.com/users',
        startedAt: 105,
      })
      const result = correlator.linkNetworkTiming(timing)

      expect(result).not.toBeNull()
    })

    it('clears pending timing entries on clear()', () => {
      const timing = makeTiming()
      correlator.linkNetworkTiming(timing) // buffered

      correlator.clear()

      // After clear, create a new visit — should not pick up old buffered entry
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 200))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 250))

      const requests = correlator.getRequests()
      expect(requests[0].network).toBeUndefined()
    })
  })
})
