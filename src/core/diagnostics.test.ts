import { describe, it, expect } from 'vitest'
import { computeDiagnostics } from './diagnostics'
import type { RequestRecord } from './types'
import type { InertiaPage } from './protocol'

function makeLocationEvent(versionChange: boolean) {
  return {
    id: 1,
    name: 'inertia:location' as const,
    timestamp: 100,
    detail: { url: 'http://localhost/posts/1', versionChange },
  }
}

function makePage(overrides: Partial<InertiaPage> = {}): InertiaPage {
  return {
    component: 'Users/Index',
    props: { users: [] },
    url: '/users',
    version: '1',
    encryptHistory: false,
    clearHistory: false,
    flash: {},
    ...overrides,
  }
}

function makeSuccessEvent(page: InertiaPage, visitId = 'visit-1') {
  return {
    id: 2,
    name: 'inertia:success' as const,
    timestamp: 150,
    detail: { page, visitId },
  }
}

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
    features: [],
    diagnostics: [],
    ...overrides,
  }
}

describe('computeDiagnostics', () => {
  it('returns empty array for a clean request', () => {
    const req = makeRequest()
    expect(computeDiagnostics(req)).toEqual([])
  })

  describe('detectVersionMismatch', () => {
    // Wire headers are the only thing that distinguishes the three meanings of
    // a 409, so these cases are driven through them.
    function make409(headers?: Record<string, string>) {
      return makeRequest({
        type: 'redirect',
        status: 409,
        wire: headers ? { response: { status: 409, headers, timestamp: 100 } } : undefined,
      } as Partial<RequestRecord>)
    }

    it('asserts version mismatch only when headers rule the alternatives out', () => {
      const diags = computeDiagnostics(make409({ 'x-inertia-version': 'abc' }))
      expect(diags).toHaveLength(1)
      expect(diags[0].id).toBe('version-mismatch')
      expect(diags[0].severity).toBe('warning')
    })

    it('hedges when the 409 is known only from timing', () => {
      // No interceptors, so no headers: the cause is genuinely unknown and
      // claiming "version mismatch" sends the developer after a bug they do
      // not have.
      const diags = computeDiagnostics(make409())
      expect(diags.find((d) => d.id === 'version-mismatch')).toBeUndefined()
      expect(diags.find((d) => d.id === 'forced-reload')).toBeDefined()
    })

    it('does not claim a reload for x-inertia-redirect — Inertia follows it client-side', () => {
      const diags = computeDiagnostics(make409({ 'x-inertia-redirect': '/dashboard' }))
      const diag = diags.find((d) => d.id === 'server-redirect')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('no page reload')
      expect(diags.find((d) => d.id === 'version-mismatch')).toBeUndefined()
    })

    it('names inertia_location rather than blaming the asset version', () => {
      // Every Inertia::location() / OAuth / Stripe redirect on 3.4 and 3.5.
      const diags = computeDiagnostics(make409({ 'x-inertia-location': 'https://checkout.stripe.com/x' }))
      expect(diags.find((d) => d.id === 'server-redirect')?.message).toContain('inertia_location')
      expect(diags.find((d) => d.id === 'version-mismatch')).toBeUndefined()
    })

    it('does not trigger for non-409 redirect', () => {
      const req = makeRequest({ type: 'redirect', status: 302 })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'version-mismatch')).toBeUndefined()
    })

    it('splits by versionChange when inertia:location was captured (Inertia >= 3.6)', () => {
      const base = { type: 'redirect' as const, status: 409 }

      const mismatch = computeDiagnostics(makeRequest({ ...base, events: [makeLocationEvent(true)] }))
      expect(mismatch.find((d) => d.id === 'version-mismatch')).toBeDefined()
      expect(mismatch.find((d) => d.id === 'server-redirect')).toBeUndefined()

      const redirect = computeDiagnostics(makeRequest({ ...base, events: [makeLocationEvent(false)] }))
      const diag = redirect.find((d) => d.id === 'server-redirect')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('inertia_location')
      expect(redirect.find((d) => d.id === 'version-mismatch')).toBeUndefined()
    })
  })

  describe('detectCancelledVisit', () => {
    it('detects interrupted visit', () => {
      const req = makeRequest({ cancelled: true, interrupted: true, completed: false })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'visit-interrupted')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('Interrupted')
    })

    it('detects interrupted-only visit (navigate away)', () => {
      const req = makeRequest({ cancelled: false, interrupted: true, completed: false })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'visit-interrupted')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('Interrupted')
    })

    it('detects cancelled (non-interrupted) visit', () => {
      const req = makeRequest({ cancelled: true, interrupted: false, completed: false })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'visit-cancelled')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('cancelled')
    })

    it('detects prevented visit', () => {
      const req = makeRequest({ prevented: true, completed: false })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'visit-prevented')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toBe('Visit prevented by an inertia:before listener')
    })
  })

  describe('detectPartialPropMissing', () => {
    it('detects missing props from partial reload', () => {
      const req = makeRequest({
        only: ['users', 'roles'],
        page: {
          component: 'Users/Index',
          props: { users: [] },
          url: '/users',
          version: '1',
          encryptHistory: false,
          clearHistory: false,
          flash: {},
        },
      })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'partial-prop-missing')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('warning')
      expect(diag!.message).toContain('roles')
    })

    it('does not trigger when all props are present', () => {
      const req = makeRequest({
        only: ['users', 'roles'],
        page: makePage({ props: { users: [], roles: [] } }),
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })

    it.each([
      ['cancelled', { cancelled: true }],
      ['interrupted', { interrupted: true }],
      ['prevented', { prevented: true }],
    ])('does not blame the server for props a %s visit never waited for', (_label, flags) => {
      // The commonest cancel path there is: open a page with a deferred prop,
      // click away before it lands. The correlator back-fills `page` from the
      // PRE-visit page so the panel has something to show — which used to make
      // the rule diff that page against the `only:` list and accuse the server
      // of dropping a prop it was never given time to send.
      const req = makeRequest({
        only: ['stats'],
        page: makePage({ props: { users: [] } }),
        ...flags,
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })

    it('resolves dot-path only entries against nested props', () => {
      // only: ['users.data'] requests the nested path (isPathOrSubPath semantics)
      const req = makeRequest({
        only: ['users.data'],
        page: makePage({ props: { users: { data: [], meta: { total: 0 } } } }),
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })

    it('detects a missing nested path even when the top-level key exists', () => {
      const req = makeRequest({
        only: ['users.data'],
        page: makePage({ props: { users: { meta: { total: 0 } } } }),
      })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'partial-prop-missing')
      expect(diag).toBeDefined()
      expect(diag!.message).toContain('users.data')
    })

    it('counts a missing intermediate segment as missing', () => {
      const req = makeRequest({
        only: ['users.data.items'],
        page: makePage({ props: { roles: [] } }),
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeDefined()
    })

    it('counts a non-object intermediate segment as missing', () => {
      const req = makeRequest({
        only: ['users.data'],
        page: makePage({ props: { users: 'nope' } }),
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeDefined()
    })
  })

  describe('detectStaleErrors', () => {
    const errors = { name: 'Name is required' }

    it('flags identical non-empty errors carried through a partial reload', () => {
      const req = makeRequest({
        only: ['users'],
        page: makePage({ props: { users: [], errors } }),
        previousPage: makePage({ props: { users: [], errors: { name: 'Name is required' } } }),
      })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'stale-errors')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('may be stale')
    })

    it('flags except-based partial reloads too', () => {
      const req = makeRequest({
        except: ['largeProp'],
        page: makePage({ props: { users: [], errors } }),
        previousPage: makePage({ props: { users: [], errors: { name: 'Name is required' } } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeDefined()
    })

    it('does not trigger for full visits', () => {
      const req = makeRequest({
        page: makePage({ props: { errors } }),
        previousPage: makePage({ props: { errors: { name: 'Name is required' } } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeUndefined()
    })

    it('does not trigger when the errors changed', () => {
      const req = makeRequest({
        only: ['users'],
        page: makePage({ props: { users: [], errors: { email: 'Invalid' } } }),
        previousPage: makePage({ props: { users: [], errors } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeUndefined()
    })

    it('does not trigger when errors are empty', () => {
      const req = makeRequest({
        only: ['users'],
        page: makePage({ props: { users: [], errors: {} } }),
        previousPage: makePage({ props: { users: [], errors: {} } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeUndefined()
    })

    it('does not trigger without a previous page to compare against', () => {
      const req = makeRequest({
        only: ['users'],
        page: makePage({ props: { users: [], errors } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeUndefined()
    })
  })

  describe('detectDiscardedResponse', () => {
    // A discarded async response: shouldSetPage() bailed, so no beforeUpdate or
    // navigate fired for this visit, but success fired with the current
    // (superseding) page.
    const supersedingPage = makePage({ component: 'Posts/Index', url: '/posts', props: { posts: [] } })

    function makeDiscarded(overrides: Partial<RequestRecord> = {}): RequestRecord {
      return makeRequest({
        only: ['users'],
        visitOptions: { async: true },
        previousPage: makePage(),
        page: supersedingPage,
        events: [makeSuccessEvent(supersedingPage)],
        ...overrides,
      })
    }

    it('flags an async success whose page shows the app moved elsewhere', () => {
      const diags = computeDiagnostics(makeDiscarded())
      const diag = diags.find((d) => d.id === 'response-discarded')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('info')
      expect(diag!.message).toContain('superseded')
    })

    it('suppresses partial-prop-missing on discarded records', () => {
      // req.page is the superseding page — judging `only` against it would lie
      const diags = computeDiagnostics(makeDiscarded())
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })

    it('does not trigger when a navigate event was attached (response applied)', () => {
      const navigate = { id: 3, name: 'inertia:navigate' as const, timestamp: 149, detail: { page: supersedingPage } }
      const req = makeDiscarded({ events: [navigate, makeSuccessEvent(supersedingPage)] })
      expect(computeDiagnostics(req).find((d) => d.id === 'response-discarded')).toBeUndefined()
    })

    it('does not trigger when a beforeUpdate event was attached (response applied)', () => {
      const beforeUpdate = {
        id: 3,
        name: 'inertia:beforeUpdate' as const,
        timestamp: 149,
        detail: { page: supersedingPage },
      }
      const req = makeDiscarded({ events: [beforeUpdate, makeSuccessEvent(supersedingPage)] })
      expect(computeDiagnostics(req).find((d) => d.id === 'response-discarded')).toBeUndefined()
    })

    it('does not trigger for sync visits', () => {
      const req = makeDiscarded({ visitOptions: undefined })
      expect(computeDiagnostics(req).find((d) => d.id === 'response-discarded')).toBeUndefined()
    })

    it('does not trigger when the app stayed on the originating page (same-URL replace)', () => {
      const samePage = makePage({ props: { users: ['Alice'] } })
      const req = makeDiscarded({ previousPage: makePage(), page: samePage, events: [makeSuccessEvent(samePage)] })
      expect(computeDiagnostics(req).find((d) => d.id === 'response-discarded')).toBeUndefined()
    })

    it('does not trigger without a success event', () => {
      const req = makeDiscarded({ events: [] })
      expect(computeDiagnostics(req).find((d) => d.id === 'response-discarded')).toBeUndefined()
    })
  })

  describe('detectDeferredFailed', () => {
    it('detects failed deferred request', () => {
      const req = makeRequest({ type: 'deferred', failed: true, error: new Error('timeout') })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'deferred-failed')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('error')
    })

    it('does not trigger for successful deferred request', () => {
      const req = makeRequest({ type: 'deferred' })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'deferred-failed')).toBeUndefined()
    })
  })
})

describe('failed requests (adversarial recall)', () => {
  it('deferred-failed fires when the deferred reload gets an HTTP error', () => {
    const req = makeRequest({ type: 'deferred', status: 500, failed: true, error: 'HTTP 500', only: ['broken'] })
    const diags = computeDiagnostics(req)
    expect(diags.some((d) => d.id === 'deferred-failed')).toBe(true)
  })

  describe('partials the server ignored', () => {
    // router.get('/elsewhere', {}, { only: ['something'] }) where /elsewhere
    // renders a different component: Inertia never applies the partial.
    const landedElsewhere = {
      only: ['something'],
      status: 200,
      previousPage: makePage({ component: 'Poll' }),
      page: makePage({ component: 'Users', props: { users: [] } }),
    }

    it('explains the redirect instead of blaming the server for a missing prop', () => {
      const diags = computeDiagnostics(makeRequest(landedElsewhere))
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
      const ignored = diags.find((d) => d.id === 'partial-ignored')
      expect(ignored?.message).toContain('Users')
      expect(ignored?.message).toContain('Poll')
    })

    it('does not report stale errors from a response that replaced the page', () => {
      const errors = { name: 'is required' }
      const req = makeRequest({
        ...landedElsewhere,
        page: makePage({ component: 'Users', props: { errors } }),
        previousPage: makePage({ component: 'Poll', props: { errors: { name: 'is required' } } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'stale-errors')).toBeUndefined()
    })

    it('stays silent when the partial stayed on its own component', () => {
      const req = makeRequest({
        only: ['users'],
        status: 200,
        previousPage: makePage({ component: 'Users' }),
        page: makePage({ component: 'Users', props: { users: [] } }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'partial-ignored')).toBeUndefined()
    })

    it('still flags a missing prop when the component is unknown', () => {
      const req = makeRequest({ only: ['ghost'], status: 200, page: makePage({ props: {} }) })
      expect(computeDiagnostics(req).find((d) => d.id === 'partial-prop-missing')).toBeDefined()
    })
  })

  describe('rescued props (required on Page since 3.4.0, not 3.6+)', () => {
    it('reports a prop the server rescued instead of blaming the partial reload', () => {
      const req = makeRequest({
        type: 'deferred',
        status: 200,
        only: ['stats'],
        page: makePage({ props: { errors: {} }, rescuedProps: ['stats'] }),
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'prop-rescued')).toBeDefined()
      // The prop is absent on purpose — the old message blamed the wrong thing.
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })

    it('still flags a genuinely missing prop alongside a rescued one', () => {
      const req = makeRequest({
        only: ['stats', 'ghost'],
        status: 200,
        page: makePage({ props: { errors: {} }, rescuedProps: ['stats'] }),
      })
      const diag = computeDiagnostics(req).find((d) => d.id === 'partial-prop-missing')
      expect(diag?.message).toContain('ghost')
      expect(diag?.message).not.toContain('stats')
    })

    it('does not re-warn on later visits that merely carry the list forward', () => {
      const req = makeRequest({
        status: 200,
        page: makePage({ rescuedProps: ['stats'] }),
        previousPage: makePage({ rescuedProps: ['stats'] }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'prop-rescued')).toBeUndefined()
    })

    it('warns again when a retry rescues the prop anew', () => {
      const req = makeRequest({
        status: 200,
        only: ['stats'],
        page: makePage({ rescuedProps: ['stats'] }),
        // Inertia drops a rescued prop from the list when a partial reload
        // re-requests it, so a fresh failure is a fresh entry.
        previousPage: makePage({ rescuedProps: [] }),
      })
      expect(computeDiagnostics(req).find((d) => d.id === 'prop-rescued')).toBeDefined()
    })

    it('stays silent when nothing was rescued', () => {
      const req = makeRequest({ status: 200, page: makePage({ rescuedProps: [] }) })
      expect(computeDiagnostics(req).find((d) => d.id === 'prop-rescued')).toBeUndefined()
    })
  })

  it('a deferred group whose response merely carried validation errors is not "failed to load"', () => {
    const req = makeRequest({ type: 'deferred', status: 200, error: { name: 'is required' }, only: ['stats'] })
    expect(computeDiagnostics(req).some((d) => d.id === 'deferred-failed')).toBe(false)
  })

  it('stale-errors still fires on a partial reload whose merged page carries validation errors', () => {
    const errors = { name: 'is required' }
    const req = makeRequest({
      only: ['time'],
      status: 200,
      // inertia:error sets record.error for any merged page carrying errors —
      // that must not be read as a failed request.
      error: errors,
      page: makePage({ props: { time: 1, errors } }),
      previousPage: makePage({ props: { time: 0, errors: { name: 'is required' } } }),
    })
    expect(computeDiagnostics(req).some((d) => d.id === 'stale-errors')).toBe(true)
  })

  it('prop-shape rules stay silent on failed requests', () => {
    const req = makeRequest({
      type: 'deferred',
      status: 500,
      error: 'HTTP 500',
      only: ['broken'],
      page: { component: 'Bugs', url: '/bugs', version: '1', props: { errors: { name: 'bad' } }, flash: {} },
      previousPage: { component: 'Bugs', url: '/bugs', version: '1', props: { errors: { name: 'bad' } }, flash: {} },
    })
    const diags = computeDiagnostics(req)
    expect(diags.some((d) => d.id === 'partial-prop-missing')).toBe(false)
    expect(diags.some((d) => d.id === 'stale-errors')).toBe(false)
  })
})
