import { describe, it, expect, beforeEach } from 'vitest'
import { Correlator } from './correlator'
import type { CapturedEvent } from './types'
import type { InertiaPage, InertiaEventName } from './protocol'
import type { NetworkTiming } from './network'

let eventId = 0
let visitSeq = 0

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
    id: `visit-${++visitSeq}`,
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
    visitSeq = 0
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

    it('correlates start and finish via visit id across object copies', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 102))
      const record = correlator.processEvent(
        makeEvent(
          'inertia:finish',
          {
            // Inertia dispatches fresh visit objects per event; the id is the link
            visit: { ...visit, completed: true },
          },
          145,
        ),
      )

      expect(record).not.toBeNull()
      expect(record!.inertiaVisitId).toBe(visit.id)
      expect(record!.events).toHaveLength(3)
    })

    it('correlates start and finish with same object reference', () => {
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

  describe('error events', () => {
    it('captures validation errors', () => {
      const visit = makeVisitObject()
      const errors = { name: 'Name is required', email: 'Invalid email' }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:error', { errors }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].error).toEqual(errors)
    })

    it('detects 409 redirect with X-Inertia-Location', () => {
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const response = {
        status: 409,
        headers: { 'x-inertia-location': '/posts/1' },
      }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].type).toBe('redirect')
      expect(requests[0].status).toBe(409)
      expect(requests[0].redirectUrl).toBe('/posts/1')
    })

    it('detects 409 redirect without headers', () => {
      const visit = makeVisitObject()
      const response = { status: 409 }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].type).toBe('redirect')
      expect(requests[0].redirectUrl).toBeUndefined()
    })

    it('captures networkError', () => {
      const visit = makeVisitObject()
      const error = new Error('Network error')

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:networkError', { error }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].error).toBe(error)
    })

    it('captures httpException status (v3 invalid)', () => {
      const visit = makeVisitObject()
      const response = { status: 500, data: '<html>Error</html>' }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))

      const requests = correlator.getRequests()
      expect(requests[0].status).toBe(500)
      expect(requests[0].failed).toBe(true)
    })

    it('marks the visit failed even when the event carries no response payload', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', {}, 145))

      // Without this, deferred-failed stays silent and the prop-shape rules
      // analyze a page the failed response never delivered.
      expect(correlator.getRequests()[0].failed).toBe(true)
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

  describe('inertia:location (Inertia >= 3.6)', () => {
    it('enriches the 409 record after httpException without creating a duplicate', () => {
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const response = { status: 409, headers: { 'x-inertia-location': '/posts' } }

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:httpException', { response }, 145))
      // location fires after httpException, carries no visit id (URL serialized by the store)
      const record = correlator.processEvent(
        makeEvent('inertia:location', { url: 'http://localhost/posts/1?tab=comments', versionChange: false }, 146),
      )

      expect(correlator.getRequests()).toHaveLength(1)
      expect(record!.type).toBe('redirect')
      expect(record!.status).toBe(409)
      expect(record!.redirectUrl).toBe('/posts/1?tab=comments')
      expect(record!.diagnostics.some((d) => d.id === 'server-redirect')).toBe(true)
      expect(record!.diagnostics.some((d) => d.id === 'version-mismatch')).toBe(false)
    })

    it('reports a version change as version mismatch', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:httpException', { response: { status: 409 } }, 145))
      const record = correlator.processEvent(
        makeEvent('inertia:location', { url: 'http://localhost/users', versionChange: true }, 146),
      )

      expect(record!.type).toBe('redirect')
      expect(record!.diagnostics.some((d) => d.id === 'version-mismatch')).toBe(true)
      expect(record!.diagnostics.some((d) => d.id === 'server-redirect')).toBe(false)
    })

    it('marks the in-flight record as redirect even without a preceding httpException', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      const record = correlator.processEvent(
        makeEvent('inertia:location', { url: new URL('http://localhost/fresh'), versionChange: true }, 120),
      )

      expect(record!.type).toBe('redirect')
      expect(record!.redirectUrl).toBe('/fresh')
    })
  })

  describe('poll visits (Inertia >= 3.6)', () => {
    it('classifies visits carrying poll: true as poll', () => {
      const visit = makeVisitObject({ poll: true })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('poll')
    })

    it('poll wins over partial but preserves only/except capture', () => {
      const visit = makeVisitObject({ poll: true, only: ['notifications'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('poll')
      expect(record!.only).toEqual(['notifications'])
    })

    it('extracts a POLL feature badge once the page arrives', () => {
      const visit = makeVisitObject({ poll: true })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage(), visitId: visit.id }, 150))

      const record = correlator.getRequests()[0]
      expect(record.features.some((f) => f.type === 'poll')).toBe(true)
    })

    it('classifies as today when the flag is absent (Inertia 3.4/3.5)', () => {
      const visit = makeVisitObject({ only: ['notifications'] })
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.type).toBe('partial')
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

    it('detects cache-served navigation (navigate with cached: true)', () => {
      const visit = makeVisitObject()

      // before fires, then navigate fires with cached: true (no start/finish)
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage(), cached: true, visitId: visit.id }, 102))

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

  describe('prevented visits (inertia:before preventDefault)', () => {
    it('finalizes a prevented before as a prevented record, not an in-flight phantom', () => {
      const visit = makeVisitObject()
      const record = correlator.processEvent({ ...makeEvent('inertia:before', { visit }, 100), prevented: true })

      expect(record).not.toBeNull()
      expect(record!.prevented).toBe(true)
      expect(record!.completed).toBe(false)
      expect(record!.finishedAt).toBe(100)
      expect(record!.duration).toBe(0)
      expect(record!.diagnostics.some((d) => d.id === 'visit-prevented')).toBe(true)
    })

    it('does not absorb later id-less events into a prevented record', () => {
      const visit = makeVisitObject()
      correlator.processEvent({ ...makeEvent('inertia:before', { visit }, 100), prevented: true })

      // The in-flight fallback must skip the finalized prevented record
      const result = correlator.processEvent(
        makeEvent('inertia:progress', { progress: { loaded: 10, total: 100, percentage: 10 } }, 110),
      )

      expect(result).toBeNull()
      expect(correlator.getRequests()[0].events).toHaveLength(1)
    })

    it('records a prevented prefetch immediately (no start will ever confirm it)', () => {
      const visit = makeVisitObject({ prefetch: true })
      const record = correlator.processEvent({ ...makeEvent('inertia:before', { visit }, 100), prevented: true })

      expect(record).not.toBeNull()
      expect(record!.prevented).toBe(true)
      expect(correlator.getRequests()).toHaveLength(1)
    })

    it('non-prevented before creates an in-flight record exactly as before', () => {
      const visit = makeVisitObject()
      const record = correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      expect(record!.prevented).toBeUndefined()
      expect(record!.finishedAt).toBeUndefined()
    })
  })

  describe('POST redirect (replace visits, page via success)', () => {
    it('extracts page from success when navigate does not fire', () => {
      // POST→302→GET back to the same URL: page.set forces replace, so navigate
      // never fires — success (carrying page + visitId) is the exact-id source.
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const page = makePage({
        component: 'Pages/Posts/Index',
        url: '/posts',
        flash: { notice: 'Created!' },
      })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))
      correlator.processEvent(makeEvent('inertia:flash', { flash: { notice: 'Created!' } }, 111))
      correlator.processEvent(makeEvent('inertia:success', { page, visitId: visit.id }, 112))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 113))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].page).toBeDefined()
      expect(requests[0].page!.component).toBe('Pages/Posts/Index')
      expect(requests[0].features.some((f) => f.type === 'flash')).toBe(true)
    })

    it('does not set page from the id-less beforeUpdate fallback', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))

      // beforeUpdate attaches the event but never pins a page — attribution is
      // heuristic and the page arrives via exact-id navigate/success instead.
      const record = correlator.getRequests()[0]
      expect(record.events.some((e) => e.name === 'inertia:beforeUpdate')).toBe(true)
      expect(record.page).toBeUndefined()
    })

    it('extracts page from error events for failed replace visits', () => {
      // Validation failure on POST→same-URL: error carries page + visitId.
      const visit = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts') })
      const errors = { title: 'Required' }
      const page = makePage({ component: 'Pages/Posts/New', url: '/posts/new', props: { errors } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))
      correlator.processEvent(makeEvent('inertia:error', { errors, page, visitId: visit.id }, 112))

      const record = correlator.getRequests()[0]
      expect(record.page).toEqual(page)
      expect(record.error).toEqual(errors)
    })

    it('navigate and success carry the same page — last writer wins harmlessly', () => {
      // Normal flow: beforeUpdate → navigate (exact id) → success (exact id),
      // all delivering the same merged page object.
      const visit = makeVisitObject()
      const page = makePage({ props: { full: true } })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))
      correlator.processEvent(makeEvent('inertia:navigate', { page, visitId: visit.id }, 115))
      correlator.processEvent(makeEvent('inertia:success', { page, visitId: visit.id }, 116))

      const requests = correlator.getRequests()
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

  describe('concurrent async visits (id-less beforeUpdate misattribution)', () => {
    it("does not pin visit A's page on visit B via the beforeUpdate fallback", () => {
      // Two concurrent async visits: A's response is applied while B is the
      // newest in-flight record. A's id-less beforeUpdate attaches to B (the
      // fallback's best guess) — but B's page must not be set from it. Each
      // record gets its page from its own exact-id success event.
      const visitA = makeVisitObject({ method: 'post', url: new URL('http://localhost/posts'), async: true })
      const visitB = makeVisitObject({ url: new URL('http://localhost/users'), async: true })
      const pageA = makePage({ component: 'Pages/Posts/Index', url: '/posts', flash: { notice: 'Created!' } })
      const pageB = makePage({ component: 'Pages/Users/Index', url: '/users' })

      correlator.processEvent(makeEvent('inertia:before', { visit: visitA }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: visitA }, 101))
      correlator.processEvent(makeEvent('inertia:before', { visit: visitB }, 110))
      correlator.processEvent(makeEvent('inertia:start', { visit: visitB }, 111))

      // A's response applies first (POST→same-URL forces replace: no navigate)
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: pageA }, 120))

      const recordA = correlator.getRequests().find((r) => r.inertiaVisitId === visitA.id)!
      const recordB = correlator.getRequests().find((r) => r.inertiaVisitId === visitB.id)!

      // The fallback attached A's beforeUpdate to B (newest in flight)…
      expect(recordB.events.some((e) => e.name === 'inertia:beforeUpdate')).toBe(true)
      // …but B's page must NOT be pinned from it
      expect(recordB.page).toBeUndefined()

      // A's page arrives via its own exact-id success event
      correlator.processEvent(makeEvent('inertia:success', { page: pageA, visitId: visitA.id }, 121))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visitA, completed: true } }, 122))

      expect(recordA.page).toEqual(pageA)
      expect(recordB.page).toBeUndefined()

      // B completes normally and gets its own page
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: pageB }, 130))
      correlator.processEvent(makeEvent('inertia:navigate', { page: pageB, visitId: visitB.id }, 131))
      correlator.processEvent(makeEvent('inertia:success', { page: pageB, visitId: visitB.id }, 132))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visitB, completed: true } }, 133))

      expect(recordA.page).toEqual(pageA)
      expect(recordB.page).toEqual(pageB)
    })

    it('flags fallback-attached events as heuristic, but not id-resolved ones', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.processEvent(
        makeEvent('inertia:progress', { progress: { loaded: 10, total: 100, percentage: 10 } }, 105),
      )
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page }, 110))
      correlator.processEvent(makeEvent('inertia:navigate', { page, visitId: visit.id }, 111))
      correlator.processEvent(makeEvent('inertia:success', { page, visitId: visit.id }, 112))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 113))

      const record = correlator.getRequests()[0]
      const byName = (name: string) => record.events.find((e) => e.name === name)!

      // id-less events resolved via the in-flight fallback
      expect(byName('inertia:progress').heuristic).toBe(true)
      expect(byName('inertia:beforeUpdate').heuristic).toBe(true)

      // events resolved by exact id (visit object or top-level visitId)
      expect(byName('inertia:before').heuristic).toBeUndefined()
      expect(byName('inertia:start').heuristic).toBeUndefined()
      expect(byName('inertia:navigate').heuristic).toBeUndefined()
      expect(byName('inertia:success').heuristic).toBeUndefined()
      expect(byName('inertia:finish').heuristic).toBeUndefined()
    })

    it('flags id-less start/finish (pre-3.4 payloads) as heuristic', () => {
      correlator.processEvent(makeEvent('inertia:before', { visit: { method: 'get' } }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: { method: 'get' } }, 101))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { method: 'get', completed: true } }, 111))

      const record = correlator.getRequests()[0]
      const byName = (name: string) => record.events.find((e) => e.name === name)!
      expect(byName('inertia:start').heuristic).toBe(true)
      expect(byName('inertia:finish').heuristic).toBe(true)
      expect(byName('inertia:before').heuristic).toBeUndefined()
    })

    it('flags an id-less navigate resolved via the in-flight fallback as heuristic', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 110))

      expect(record!.inertiaVisitId).toBe(visit.id)
      expect(record!.events.find((e) => e.name === 'inertia:navigate')!.heuristic).toBe(true)
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

    it('routes deferred navigate to the deferred record by visit id, leaving the parent intact', () => {
      const visit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:navigate', { page, visitId: visit.id }, 145))

      // Deferred reload starts
      const deferredVisit = makeVisitObject({ deferredProps: true, only: ['sidebar'] })
      correlator.processEvent(makeEvent('inertia:before', { visit: deferredVisit }, 150))

      // In 3.4, the deferred reload's navigate carries the deferred visit's own id
      const updatedPage = makePage({ props: { users: [], sidebar: 'loaded' } })
      const navRecord = correlator.processEvent(
        makeEvent('inertia:navigate', { page: updatedPage, visitId: deferredVisit.id }, 160),
      )

      expect(navRecord!.visitId).toBe(2)
      expect(navRecord!.type).toBe('deferred')
      expect(navRecord!.page).toEqual(updatedPage)
      // Parent keeps the page from its own response
      expect(correlator.getRequest(1)!.page).toEqual(page)
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

      // Server responds; beforeUpdate/navigate update lastPage
      const mergedPage = makePage({ props: { users: [], comments: ['Great post!'] } })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: mergedPage }, 200))
      correlator.processEvent(makeEvent('inertia:navigate', { page: mergedPage, visitId: deferredVisit.id }, 201))

      // Finish goes to deferred record via visit id
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
      correlator.processEvent(makeEvent('inertia:navigate', { page: mergedPage, visitId: deferredVisit.id }, 201))

      // Finish goes to deferred record via visit id
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
      correlator.processEvent(makeEvent('inertia:navigate', { page: sidebarMergedPage, visitId: sidebarVisit.id }, 201))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...sidebarVisit, completed: true } }, 202))

      // Comments response arrives second
      const commentsMergedPage = makePage({
        props: { errors: {}, title: 'Demo', sidebar: { items: ['nav1'] }, comments: ['Great!'] },
      })
      correlator.processEvent(makeEvent('inertia:beforeUpdate', { page: commentsMergedPage }, 300))
      correlator.processEvent(
        makeEvent('inertia:navigate', { page: commentsMergedPage, visitId: commentsVisit.id }, 301),
      )
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

    it('marks the true initial load (no prior page state) with the initial flag', () => {
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 50))
      expect(record!.initial).toBe(true)
    })

    it('does not mark mid-session synthetic records (history restore) as initial', () => {
      correlator.processEvent(makeEvent('inertia:navigate', { page: makePage() }, 50))

      // popstate restore: id-less navigate with prior page state
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page: makePage({ url: '/back' }) }, 500))

      expect(record!.initial).toBeUndefined()
      expect(record!.startedAt).toBe(500)
    })
  })

  describe('reused visit id (x-inertia-redirect)', () => {
    // Inertia follows a 409 + x-inertia-redirect by calling router.visit with
    // `...requestParams.all()`, which still carries the original `id` — and
    // getPendingVisit spreads those options after `id: createVisitId()`, so the
    // old id wins. Two visits, one uuid.
    const REUSED = 'visit-reused'

    function redirectSequence(target: Correlator) {
      target.processEvent(
        makeEvent(
          'inertia:before',
          {
            visit: makeVisitObject({ id: REUSED, method: 'post', url: new URL('http://localhost/posts') }),
          },
          100,
        ),
      )
      target.processEvent(makeEvent('inertia:start', { visit: makeVisitObject({ id: REUSED, method: 'post' }) }, 110))
      // The redirect follow-up reuses the id.
      target.processEvent(
        makeEvent(
          'inertia:before',
          {
            visit: makeVisitObject({ id: REUSED, method: 'get', url: new URL('http://localhost/posts') }),
          },
          200,
        ),
      )
      target.processEvent(makeEvent('inertia:start', { visit: makeVisitObject({ id: REUSED, method: 'get' }) }, 210))
      target.processEvent(makeEvent('inertia:finish', { visit: makeVisitObject({ id: REUSED }) }, 260))
    }

    it('leaves no record stuck in flight', () => {
      redirectSequence(correlator)
      const unfinished = correlator.getRequests().filter((r) => r.finishedAt == null)
      expect(unfinished).toEqual([])
    })

    it('reports the superseded request as a redirect rather than a phantom', () => {
      redirectSequence(correlator)
      const first = correlator.getRequests().find((r) => r.method === 'POST')!
      expect(first.type).toBe('redirect')
      expect(first.redirectUrl).toBe('/posts')
      expect(first.completed).toBe(true)
    })

    it('stops the zombie from absorbing later id-less events', () => {
      redirectSequence(correlator)
      // An id-less failure from some *later* traffic must not land on the
      // superseded record via the in-flight fallback.
      const before = correlator.getRequests().find((r) => r.method === 'POST')!.events.length
      correlator.processEvent(makeEvent('inertia:networkError', { error: 'boom' }, 300))
      const after = correlator.getRequests().find((r) => r.method === 'POST')!
      expect(after.events.length).toBe(before)
      expect(after.failed).toBeUndefined()
    })

    it('lets the superseded record be evicted like any finished one', () => {
      const small = new Correlator(2)
      redirectSequence(small)
      for (let i = 0; i < 3; i++) {
        correlator.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: `later-${i}` }) }, 400 + i))
      }
      expect(small.getRequests().length).toBeLessThanOrEqual(2)
    })
  })

  describe('event cap and uuid unlink', () => {
    it('bounds the events array on a record that never finishes', () => {
      // Any id-less event resolves to the newest in-flight record, so a hung
      // visit accumulated forever — 5,001 entries after 5,000 progress ticks.
      correlator.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: 'stuck' }) }, 1))
      correlator.processEvent(makeEvent('inertia:start', { visit: makeVisitObject({ id: 'stuck' }) }, 2))
      for (let i = 0; i < 2000; i++) {
        correlator.processEvent(makeEvent('inertia:progress', { percentage: i % 100 }, 10 + i))
      }
      const record = correlator.getRequests().find((r) => r.inertiaVisitId === 'stuck')!
      expect(record.events.length).toBeLessThanOrEqual(500)
      expect(record.droppedEvents).toBeGreaterThan(0)
    })

    it('keeps the structural events and drops progress first', () => {
      correlator.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: 'keep' }) }, 1))
      correlator.processEvent(makeEvent('inertia:start', { visit: makeVisitObject({ id: 'keep' }) }, 2))
      for (let i = 0; i < 1000; i++) {
        correlator.processEvent(makeEvent('inertia:progress', {}, 10 + i))
      }
      const record = correlator.getRequests().find((r) => r.inertiaVisitId === 'keep')!
      const names = record.events.map((e) => e.name)
      expect(names).toContain('inertia:before')
      expect(names).toContain('inertia:start')
    })

    it('does not orphan a live record when evicting an older one that shares its uuid', () => {
      // After an x-inertia-redirect two records share a uuid and the map points
      // at the newer. Evicting the older used to delete that mapping, so the
      // live record's own finish resolved to nothing.
      const small = new Correlator(2)
      const SHARED = 'shared-uuid'
      small.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: SHARED, method: 'post' }) }, 1))
      small.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: SHARED, method: 'get' }) }, 2))
      // Push the older (now finalized) record out of the buffer.
      small.processEvent(makeEvent('inertia:before', { visit: makeVisitObject({ id: 'other' }) }, 3))

      const finished = small.processEvent(makeEvent('inertia:finish', { visit: makeVisitObject({ id: SHARED }) }, 4))
      expect(finished).not.toBeNull()
      expect(finished!.method).toBe('GET')
    })
  })

  describe('id-less failure events (U3: the fourth resolveInFlight site)', () => {
    it("does not let a prefetch swallow the click visit's network error", () => {
      // Reproduces round 3's U3: a POST fails while a hover-prefetch is the
      // newest in-flight record, and inertia:networkError carries no visit id.
      // The other two id-less fallbacks were hardened; resolveEventRecord was not.
      const click = makeVisitObject({ method: 'post', url: new URL('http://localhost/save') })
      correlator.processEvent(makeEvent('inertia:before', { visit: click }, 100))
      const prefetch = makeVisitObject({ prefetch: true, url: new URL('http://localhost/next') })
      correlator.processEvent(makeEvent('inertia:before', { visit: prefetch }, 110))
      correlator.processEvent(makeEvent('inertia:start', { visit: prefetch }, 111))

      correlator.processEvent(makeEvent('inertia:networkError', { error: new Error('boom') }, 200))

      const saveRow = correlator.getRequests().find((r) => r.url === '/save')!
      const prefetchRow = correlator.getRequests().find((r) => r.url === '/next')!
      expect(saveRow.failed).toBe(true)
      expect(prefetchRow.failed).toBeUndefined()
    })

    it('a poll cannot steal an id-less failure either', () => {
      const click = makeVisitObject({ url: new URL('http://localhost/posts') })
      correlator.processEvent(makeEvent('inertia:before', { visit: click }, 100))
      const poll = makeVisitObject({ poll: true, url: new URL('http://localhost/notifications') })
      correlator.processEvent(makeEvent('inertia:before', { visit: poll }, 110))

      correlator.processEvent(makeEvent('inertia:networkError', { error: new Error('boom') }, 200))

      expect(correlator.getRequests().find((r) => r.url === '/posts')!.failed).toBe(true)
      expect(correlator.getRequests().find((r) => r.url === '/notifications')!.failed).toBeUndefined()
    })

    it('still delivers a failure to a deferred group — deferred is NOT excluded', () => {
      // deferred-failed depends on the networkError reaching the deferred record.
      const deferred = makeVisitObject({ url: new URL('http://localhost/stats') })
      const rec = correlator.processEvent(makeEvent('inertia:before', { visit: deferred }, 100))
      rec!.type = 'deferred'
      correlator.processEvent(makeEvent('inertia:networkError', { error: new Error('boom') }, 200))
      expect(correlator.getRequests().find((r) => r.url === '/stats')!.failed).toBe(true)
    })
  })

  describe('record eviction', () => {
    it('expires cache-fresh prefetch entries by age, not only by count', () => {
      // pendingPrefetch drains on inertia:start, which a cache-FRESH prefetch
      // never fires. Those entries had exactly one exit: being pushed out by
      // the size cap — so raising that cap 20 -> 200 (to stop a prefetch="mount"
      // list dropping rows) raised the permanent retention tenfold.
      const c = new Correlator()
      const stale = makeVisitObject({ prefetch: true, url: new URL('http://localhost/a') })
      c.processEvent(makeEvent('inertia:before', { visit: stale }, 0))

      // A much later prefetch sweeps the expired one out.
      const fresh = makeVisitObject({ prefetch: true, url: new URL('http://localhost/b') })
      c.processEvent(makeEvent('inertia:before', { visit: fresh }, 100_000))

      // The stale entry is gone: its start can no longer promote it to a record.
      expect(c.processEvent(makeEvent('inertia:start', { visit: stale }, 100_001))).toBeNull()
      // The fresh one still can.
      expect(c.processEvent(makeEvent('inertia:start', { visit: fresh }, 100_002))).not.toBeNull()
    })

    it('evicts a long-dead in-flight record instead of holding its slot forever', () => {
      // A visit that never finishes — hung request, tab backgrounded mid-flight,
      // connection dropped with no error event — has finishedAt == null forever.
      // The loop skipped it looking for something finished and only fell through
      // to shift() when NOTHING was finished, so it held a buffer slot for the
      // life of the page AND stayed eligible for the in-flight fallback,
      // quietly collecting other visits' id-less events.
      const small = new Correlator(2)
      const hung = makeVisitObject({ url: new URL('http://localhost/hung') })
      small.processEvent(makeEvent('inertia:before', { visit: hung }, 0)) // never finishes

      // Two later, finished visits, well past the staleness window.
      for (const t of [100_000, 200_000]) {
        const v = makeVisitObject()
        small.processEvent(makeEvent('inertia:before', { visit: v }, t))
        small.processEvent(makeEvent('inertia:finish', { visit: { ...v, completed: true } }, t + 10))
      }

      expect(small.getRequests().some((r) => r.url === '/hung')).toBe(false)
    })

    it('keeps a RECENT in-flight record — slow is not dead', () => {
      const small = new Correlator(2)
      const slow = makeVisitObject({ url: new URL('http://localhost/slow') })
      small.processEvent(makeEvent('inertia:before', { visit: slow }, 1000))

      for (const t of [1100, 1200]) {
        const v = makeVisitObject()
        small.processEvent(makeEvent('inertia:before', { visit: v }, t))
        small.processEvent(makeEvent('inertia:finish', { visit: { ...v, completed: true } }, t + 10))
      }

      expect(small.getRequests().some((r) => r.url === '/slow')).toBe(true)
    })

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

  describe('visit id correlation (v3.4)', () => {
    it('correlates concurrent identical visits finishing out of order', () => {
      // Two visits to the same URL/method — indistinguishable without ids
      const visitA = makeVisitObject()
      const visitB = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit: visitA }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: visitA }, 101))
      correlator.processEvent(makeEvent('inertia:before', { visit: visitB }, 110))
      correlator.processEvent(makeEvent('inertia:start', { visit: visitB }, 111))

      // B finishes BEFORE A (out of FIFO order)
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visitB, completed: true } }, 130))
      correlator.processEvent(
        makeEvent('inertia:finish', { visit: { ...visitA, completed: true, interrupted: true } }, 150),
      )

      const requests = correlator.getRequests()
      const recordA = requests.find((r) => r.inertiaVisitId === visitA.id)!
      const recordB = requests.find((r) => r.inertiaVisitId === visitB.id)!

      expect(recordB.finishedAt).toBe(130)
      expect(recordB.duration).toBe(20)
      expect(recordA.finishedAt).toBe(150)
      expect(recordA.duration).toBe(50)
      expect(recordA.interrupted).toBe(true)
      expect(recordB.interrupted).toBe(false)
    })

    it('routes success and error to the right record by visitId', () => {
      const visitA = makeVisitObject()
      const visitB = makeVisitObject({ url: new URL('http://localhost/posts') })
      const errors = { title: 'Required' }

      correlator.processEvent(makeEvent('inertia:before', { visit: visitA }, 100))
      correlator.processEvent(makeEvent('inertia:before', { visit: visitB }, 110))

      correlator.processEvent(makeEvent('inertia:error', { errors, visitId: visitB.id }, 140))
      correlator.processEvent(makeEvent('inertia:success', { page: makePage(), visitId: visitA.id }, 145))

      const requests = correlator.getRequests()
      const recordA = requests.find((r) => r.inertiaVisitId === visitA.id)!
      const recordB = requests.find((r) => r.inertiaVisitId === visitB.id)!

      expect(recordB.error).toEqual(errors)
      expect(recordA.error).toBeUndefined()
      expect(recordA.events.some((e) => e.name === 'inertia:success')).toBe(true)
      expect(recordB.events.some((e) => e.name === 'inertia:success')).toBe(false)
    })

    it('tracks two prefetches hovered in quick succession', () => {
      const prefetchA = makeVisitObject({ prefetch: true, url: new URL('http://localhost/a') })
      const prefetchB = makeVisitObject({ prefetch: true, url: new URL('http://localhost/b') })

      // Both before events fire before either start (rapid hover)
      correlator.processEvent(makeEvent('inertia:before', { visit: prefetchA }, 100))
      correlator.processEvent(makeEvent('inertia:before', { visit: prefetchB }, 101))

      correlator.processEvent(makeEvent('inertia:start', { visit: prefetchA }, 102))
      correlator.processEvent(makeEvent('inertia:start', { visit: prefetchB }, 103))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(2)
      expect(requests[0].type).toBe('prefetch')
      expect(requests[1].type).toBe('prefetch')
      expect(requests.map((r) => r.url).toSorted()).toEqual(['/a', '/b'])
    })

    it('finalizes a cache-served click on navigate without start/finish', () => {
      // Click on a prefetched link: before fires with a fresh id, no start,
      // then navigate with cached: true and the same id. finish never fires.
      const clickVisit = makeVisitObject()
      const page = makePage()

      correlator.processEvent(makeEvent('inertia:before', { visit: clickVisit }, 100))
      const record = correlator.processEvent(
        makeEvent('inertia:navigate', { page, cached: true, visitId: clickVisit.id }, 105),
      )

      expect(record).not.toBeNull()
      expect(record!.inertiaVisitId).toBe(clickVisit.id)
      expect(record!.cached).toBe(true)
      expect(record!.completed).toBe(true)
      expect(record!.finishedAt).toBe(105)
      expect(record!.page).toEqual(page)
    })

    it('attaches flash to the most recent record when nothing is in flight (router.flash())', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 140))

      // router.flash() fires only inertia:flash — no visit in flight
      const record = correlator.processEvent(makeEvent('inertia:flash', { flash: { notice: 'Saved!' } }, 200))

      expect(record).not.toBeNull()
      expect(record!.inertiaVisitId).toBe(visit.id)
    })

    it('handles finish for an evicted visit id without misattribution', () => {
      const smallCorrelator = new Correlator(1)

      const visitA = makeVisitObject({ url: new URL('http://localhost/a') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visitA }, 100))
      smallCorrelator.processEvent(makeEvent('inertia:finish', { visit: { ...visitA, completed: true } }, 110))

      // B evicts A (capacity 1)
      const visitB = makeVisitObject({ url: new URL('http://localhost/b') })
      smallCorrelator.processEvent(makeEvent('inertia:before', { visit: visitB }, 200))

      // Late event for evicted A must not attach to B: explicit id resolves
      // exactly or not at all
      const result = smallCorrelator.processEvent(
        makeEvent('inertia:success', { page: makePage(), visitId: visitA.id }, 210),
      )

      expect(result).toBeNull()
      const recordB = smallCorrelator.getRequests()[0]
      expect(recordB.events.some((e) => e.name === 'inertia:success')).toBe(false)
    })

    it('records before events without a visit id (pre-3.4 payloads) without crashing', () => {
      const record = correlator.processEvent(makeEvent('inertia:before', { visit: { method: 'get' } }, 100))
      expect(record).not.toBeNull()
      expect(record!.inertiaVisitId).toBeUndefined()
    })
  })

  describe('explicit-id resolution and id-less fallbacks', () => {
    it('marks visit as cancelled from finish flags', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, cancelled: true } }, 120))

      const record = correlator.getRequests()[0]
      expect(record.cancelled).toBe(true)
      expect(record.completed).toBe(false)
    })

    it('attaches id-less progress events to the in-flight record', () => {
      const visit = makeVisitObject()

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      const record = correlator.processEvent(
        makeEvent('inertia:progress', { progress: { loaded: 10, total: 100, percentage: 10 } }, 110),
      )

      expect(record).not.toBeNull()
      expect(record!.inertiaVisitId).toBe(visit.id)
      expect(correlator.getRequests()).toHaveLength(1)
    })

    it('does not attach finish with an unknown explicit id to an unrelated in-flight record', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      const result = correlator.processEvent(
        makeEvent('inertia:finish', { visit: { id: 'unknown-visit', completed: true } }, 150),
      )

      expect(result).toBeNull()
      expect(correlator.getRequests()[0].finishedAt).toBeUndefined()
    })

    it('does not attach start with an unknown explicit id to an unrelated in-flight record', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))

      const result = correlator.processEvent(makeEvent('inertia:start', { visit: { id: 'unknown-visit' } }, 105))

      expect(result).toBeNull()
      expect(correlator.getRequests()[0].events).toHaveLength(1)
    })

    it('id-less navigate (history restore) does not attach to an in-flight prefetch', () => {
      const prefetchVisit = makeVisitObject({ prefetch: true })
      correlator.processEvent(makeEvent('inertia:before', { visit: prefetchVisit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit: prefetchVisit }, 101))

      // popstate restore: navigate with no visitId
      const restoredPage = makePage({ url: '/back' })
      const record = correlator.processEvent(makeEvent('inertia:navigate', { page: restoredPage }, 150))

      expect(record).not.toBeNull()
      expect(record!.type).toBe('full')
      const prefetchRecord = correlator.getRequests().find((r) => r.type === 'prefetch')!
      expect(prefetchRecord.events.some((e) => e.name === 'inertia:navigate')).toBe(false)
    })
  })

  describe('client-side visits (inertia:clientVisit)', () => {
    it('converts the navigate-created record for router.push() instead of duplicating', () => {
      // Real 3.4 sequence for router.push(): navigate (with the client visit's
      // id) fires BEFORE clientVisit — both must land on one record.
      const initialPage = makePage({ props: { count: 1 } })
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 50))

      const newPage = makePage({ url: '/users?tab=active', props: { count: 2 } })
      correlator.processEvent(makeEvent('inertia:navigate', { page: newPage, visitId: 'client-9' }, 100))
      const record = correlator.processEvent(
        makeEvent('inertia:clientVisit', { page: newPage, replace: false, visitId: 'client-9' }, 101),
      )

      expect(record).not.toBeNull()
      expect(correlator.getRequests()).toHaveLength(2) // initial + client, no phantom
      expect(record!.type).toBe('client')
      expect(record!.method).toBe('PUSH')
      // diff baseline is the page BEFORE the push, not the pushed page
      expect(record!.previousPage).toEqual(initialPage)
      expect(record!.page).toEqual(newPage)
      expect(record!.events.some((e) => e.name === 'inertia:navigate')).toBe(true)
      expect(record!.events.some((e) => e.name === 'inertia:clientVisit')).toBe(true)
    })

    it('creates a PUSH client record for router.push()', () => {
      const initialPage = makePage()
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 50))

      const newPage = makePage({ url: '/users?tab=active', props: { users: [], tab: 'active' } })
      const record = correlator.processEvent(
        makeEvent('inertia:clientVisit', { page: newPage, replace: false, visitId: 'client-1' }, 100),
      )

      expect(record).not.toBeNull()
      expect(record!.type).toBe('client')
      expect(record!.method).toBe('PUSH')
      expect(record!.url).toBe('/users?tab=active')
      expect(record!.inertiaVisitId).toBe('client-1')
      expect(record!.completed).toBe(true)
      expect(record!.duration).toBe(0)
      expect(correlator.getCurrentPage()).toEqual(newPage)
    })

    it('creates a REPLACE client record for router.replace()/replaceProp()', () => {
      const initialPage = makePage({ props: { count: 1 } })
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 50))

      // replaceProp routes through router.replace → clientVisit with replace: true
      const updatedPage = makePage({ props: { count: 2 } })
      const record = correlator.processEvent(
        makeEvent('inertia:clientVisit', { page: updatedPage, replace: true, visitId: 'client-2' }, 100),
      )

      expect(record!.method).toBe('REPLACE')
      // previousPage enables the props diff view
      expect(record!.previousPage).toEqual(initialPage)
      expect(record!.page).toEqual(updatedPage)
    })

    it('gives client visits diagnostics — the only handler that never computed them', () => {
      // handleClientVisit was the one handler that skipped computeDiagnostics on
      // BOTH paths, so every router.replace()/replaceProp() visit was inserted
      // with `diagnostics: []` and stayed that way. detectHistoryReplace's first
      // branch was therefore unreachable in production while its unit test
      // passed — the rule was covered and dead at the same time.
      const initialPage = makePage({ props: { count: 1 } })
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage }, 50))

      const replaced = correlator.processEvent(
        makeEvent(
          'inertia:clientVisit',
          { page: makePage({ props: { count: 2 } }), replace: true, visitId: 'c-1' },
          100,
        ),
      )
      expect(replaced!.diagnostics.map((d) => d.id)).toContain('history-replace')

      // The new-record path AND the adopt-an-existing-record path both funnel.
      correlator.processEvent(makeEvent('inertia:navigate', { page: initialPage, visitId: 'c-2' }, 200))
      const adopted = correlator.processEvent(
        makeEvent(
          'inertia:clientVisit',
          { page: makePage({ props: { count: 3 } }), replace: true, visitId: 'c-2' },
          201,
        ),
      )
      expect(adopted!.diagnostics.map((d) => d.id)).toContain('history-replace')
    })

    it('ignores clientVisit without a page payload', () => {
      const record = correlator.processEvent(
        makeEvent('inertia:clientVisit', { replace: false, visitId: 'client-3' }, 100),
      )
      expect(record).toBeNull()
      expect(correlator.getRequests()).toHaveLength(0)
    })

    it('router.flash() updates the current record via flash event, not a client record', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...visit, completed: true } }, 140))

      // router.flash() fires only inertia:flash — no clientVisit event
      correlator.processEvent(makeEvent('inertia:flash', { flash: { notice: 'Hi' } }, 200))

      const requests = correlator.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].type).not.toBe('client')
      expect(requests[0].events.some((e) => e.name === 'inertia:flash')).toBe(true)
    })
  })

  describe('wire data from lifecycle events', () => {
    it('captures prefetch response wire data from inertia:prefetched', () => {
      const visit = makeVisitObject({ prefetch: true })

      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      const record = correlator.processEvent(
        makeEvent(
          'inertia:prefetched',
          {
            visit,
            fetchedAt: 200,
            response: { status: 200, data: '{"component":"Users"}', headers: { 'x-inertia': 'true' } },
          },
          200,
        ),
      )

      expect(record).not.toBeNull()
      expect(record!.wire?.response).toMatchObject({ status: 200, headers: { 'x-inertia': 'true' } })
      expect(record!.status).toBe(200)
    })

    it('captures exception response wire data from inertia:httpException', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      const record = correlator.processEvent(
        makeEvent(
          'inertia:httpException',
          { response: { status: 500, data: '<html>oops</html>', headers: { 'content-type': 'text/html' } } },
          145,
        ),
      )

      expect(record!.status).toBe(500)
      expect(record!.wire?.response).toMatchObject({
        status: 500,
        headers: { 'content-type': 'text/html' },
      })
    })

    it('interceptor wire data does not overwrite via prefetched when already present', () => {
      const visit = makeVisitObject({ prefetch: true })
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))

      // Interceptor attached first (hypothetically)
      correlator.attachWireResponse(visit.id as string, {
        status: 200,
        headers: { source: 'interceptor' },
        finishedAt: 150,
      })

      correlator.processEvent(
        makeEvent('inertia:prefetched', { visit, response: { status: 200, headers: { source: 'event' } } }, 200),
      )

      const record = correlator.getRequests()[0]
      expect(record.wire?.response?.headers).toEqual({ source: 'interceptor' })
    })

    it('attachWireRequest returns null for unknown ids', () => {
      expect(correlator.attachWireRequest('nope', { method: 'GET', url: '/x', headers: {}, startedAt: 1 })).toBeNull()
    })
  })

  describe('network timing correlation', () => {
    it("does not let a poll tick steal a click visit's beforeUpdate", () => {
      // A router.poll() tick starting mid-navigation is the NEWEST in-flight
      // record, so the id-less beforeUpdate fallback handed it the user's click
      // visit's event. Prefetch was excluded from that fallback; poll was not.
      const click = makeVisitObject({ url: new URL('http://localhost/posts') })
      correlator.processEvent(makeEvent('inertia:before', { visit: click }, 100))
      const poll = makeVisitObject({ poll: true, url: new URL('http://localhost/notifications') })
      const pollRecord = correlator.processEvent(makeEvent('inertia:before', { visit: poll }, 110))
      expect(pollRecord!.type).toBe('poll')

      const target = correlator.processEvent(makeEvent('inertia:beforeUpdate', {}, 120))
      expect(target!.url).toBe('/posts')
    })

    it('still uses a poll for beforeUpdate when it is the only visit in flight', () => {
      // Excluding polls must not mean polls never receive their own events.
      const poll = makeVisitObject({ poll: true, url: new URL('http://localhost/notifications') })
      correlator.processEvent(makeEvent('inertia:before', { visit: poll }, 100))
      const target = correlator.processEvent(makeEvent('inertia:beforeUpdate', {}, 110))
      expect(target).not.toBeNull()
      expect(target!.url).toBe('/notifications')
    })

    it('attaches a timing to the CLOSEST visit, not the newest eligible one', () => {
      // router.poll(1000) produces a run of records sharing one URL, and the
      // match window is +/-2000ms, so several are eligible at once. Scanning
      // backwards and taking the first hit gave the timing to the newest — the
      // wrong duration on that record, and none at all on its real owner.
      const first = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit: first }, 1000))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...first, completed: true } }, 1100))
      const second = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit: second }, 2000))
      correlator.processEvent(makeEvent('inertia:finish', { visit: { ...second, completed: true } }, 2100))

      // Clearly the first poll tick's request.
      const matched = correlator.linkNetworkTiming(makeTiming({ startedAt: 1010, finishedAt: 1090 }))
      expect(matched).not.toBeNull()
      expect(matched!.startedAt).toBe(1000)
    })

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

    it('uses responseStatus as a status fallback with a forced-reload diagnostic for 409', () => {
      // Inertia 3.4/3.5 fire no event for a 409 + X-Inertia-Location — the
      // Resource Timing entry is the only trace of the forced reload.
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))

      const timing = makeTiming({ startedAt: 105, finishedAt: 140, responseStatus: 409 })
      const result = correlator.linkNetworkTiming(timing)

      expect(result!.status).toBe(409)
      expect(result!.diagnostics.some((d) => d.id === 'forced-reload')).toBe(true)
    })

    it('does not overwrite a status reported by events or interceptors', () => {
      const visit = makeVisitObject()
      correlator.processEvent(makeEvent('inertia:before', { visit }, 100))
      correlator.processEvent(makeEvent('inertia:start', { visit }, 101))
      correlator.attachWireResponse(visit.id as string, { status: 200, headers: {}, finishedAt: 140 })

      const timing = makeTiming({ startedAt: 105, finishedAt: 140, responseStatus: 409 })
      const result = correlator.linkNetworkTiming(timing)

      expect(result!.status).toBe(200)
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
