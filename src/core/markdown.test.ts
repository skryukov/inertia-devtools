import { describe, it, expect } from 'vitest'
import { requestToMarkdown, diffToMarkdown, eventsToMarkdown, networkToMarkdown, requestToJSON } from './markdown'
import type { RequestRecord, CapturedEvent } from './types'
import type { InertiaPage } from './protocol'

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    visitId: 1,
    type: 'full',
    method: 'GET',
    url: '/users',
    status: 200,
    startedAt: 0,
    finishedAt: 45,
    duration: 45,
    page: {
      component: 'Pages/Users/Index',
      props: { users: [1, 2], flash: {} },
      url: '/users',
      version: 'a3f2c1d',
      clearHistory: false,
      encryptHistory: false,
      flash: {},
    },
    events: [],
    features: [],
    diagnostics: [],
    cancelled: false,
    interrupted: false,
    completed: true,
    ...overrides,
  }
}

function makePage(overrides: Partial<InertiaPage> = {}): InertiaPage {
  return {
    component: 'Pages/Users/Index',
    props: {},
    url: '/users',
    version: 'a3f2c1d',
    clearHistory: false,
    encryptHistory: false,
    flash: {},
    ...overrides,
  }
}

function makeEvent(
  id: number,
  name: CapturedEvent['name'],
  timestamp: number,
  detail: Record<string, unknown> = {},
  prevented?: boolean,
): CapturedEvent {
  return { id, name, timestamp, detail, ...(prevented !== undefined && { prevented }) }
}

describe('requestToMarkdown', () => {
  it('includes header with navigation info', () => {
    const md = requestToMarkdown(makeRequest())
    expect(md).toContain('## Inertia Request')
    expect(md).toContain('**Navigation:** GET /users → 200 (45ms)')
    expect(md).toContain('**Component:** Pages/Users/Index')
    expect(md).toContain('**Type:** full')
  })

  it('shows "initial page load" for records with the initial flag', () => {
    const md = requestToMarkdown(makeRequest({ initial: true, duration: 0 }))
    expect(md).toContain('(initial page load)')
  })

  it('does not label mid-session zero-duration records as initial', () => {
    // history-restore synthetics have duration 0 but no initial flag
    const md = requestToMarkdown(makeRequest({ duration: 0 }))
    expect(md).not.toContain('(initial page load)')
    expect(md).toContain('(0ms)')
  })

  it('shows "client-side" for client visits', () => {
    const md = requestToMarkdown(makeRequest({ type: 'client' }))
    expect(md).toContain('(client-side)')
  })

  it('shows "in-flight" when no timing info', () => {
    const md = requestToMarkdown(
      makeRequest({
        duration: undefined,
        startedAt: undefined,
        finishedAt: undefined,
      }),
    )
    expect(md).toContain('(in-flight)')
  })

  it('includes raw page JSON', () => {
    const md = requestToMarkdown(makeRequest())
    expect(md).toContain('### Page Object')
    expect(md).toContain('```json')
    expect(md).toContain('"component": "Pages/Users/Index"')
    expect(md).toContain('"users"')
  })

  it('formats active features with descriptions', () => {
    const md = requestToMarkdown(
      makeRequest({
        features: [
          { type: 'partial', label: 'Include keys: users, roles', details: {} },
          { type: 'flash', label: 'Flash data present', details: {} },
        ],
      }),
    )
    expect(md).toContain('### Features')
    expect(md).toContain('- **partial**')
    expect(md).toContain('- **flash**')
  })

  it('includes error section when present', () => {
    const md = requestToMarkdown(
      makeRequest({
        error: 'Network Error: timeout',
      }),
    )
    expect(md).toContain('### Error')
    expect(md).toContain('Network Error: timeout')
  })

  it('renders validation errors as JSON rather than [object Object]', () => {
    // inertia:error puts a field bag on `error` for a page that merged fine.
    const md = requestToMarkdown(makeRequest({ error: { name: 'The name field is required.' } }))
    expect(md).not.toContain('[object Object]')
    expect(md).toContain('### Validation Errors')
    expect(md).toContain('The name field is required.')
  })

  it('omits the section for falsy error values', () => {
    for (const error of ['', 0, false, null, undefined]) {
      expect(requestToMarkdown(makeRequest({ error }))).not.toContain('### Error')
    }
  })

  it('omits the section for an empty error bag', () => {
    // Laravel/Rails adapters share `errors` on every page, empty or not.
    expect(requestToMarkdown(makeRequest({ error: {} }))).not.toContain('Validation Errors')
  })

  it('reports a failed request as an error, not a validation bag', () => {
    const md = requestToMarkdown(makeRequest({ failed: true, status: 500, error: 'HTTP 500' }))
    expect(md).toContain('### Error')
    expect(md).not.toContain('Validation Errors')
  })

  it('renders an Error instance by message', () => {
    const md = requestToMarkdown(makeRequest({ failed: true, error: new Error('boom') }))
    expect(md).toContain('Error: boom')
    expect(md).not.toContain('[object Object]')
  })

  it('survives a circular error value', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(() => requestToMarkdown(makeRequest({ failed: true, error: circular }))).not.toThrow()
  })

  it('shows cancelled/interrupted flags', () => {
    const md = requestToMarkdown(makeRequest({ cancelled: true }))
    expect(md).toContain('**Cancelled:** Yes')

    const md2 = requestToMarkdown(makeRequest({ interrupted: true }))
    expect(md2).toContain('**Interrupted:** Yes')
  })

  it('shows prevented flag', () => {
    const md = requestToMarkdown(makeRequest({ prevented: true, completed: false }))
    expect(md).toContain('**Prevented:** Yes')
  })

  it('handles request with no page object', () => {
    const md = requestToMarkdown(makeRequest({ page: undefined }))
    expect(md).toContain('## Inertia Request')
    expect(md).not.toContain('**Component:**')
    expect(md).not.toContain('### Page Object')
  })

  it('shows only/except filters', () => {
    const md = requestToMarkdown(
      makeRequest({
        only: ['users', 'roles'],
        except: ['flash'],
      }),
    )
    expect(md).toContain('**Only:** `users`, `roles`')
    expect(md).toContain('**Except:** `flash`')
  })

  it('omits status from navigation when not present', () => {
    const md = requestToMarkdown(makeRequest({ status: undefined }))
    expect(md).toContain('**Navigation:** GET /users (45ms)')
    expect(md).not.toContain('→')
  })

  it('omits features section when no features', () => {
    const md = requestToMarkdown(makeRequest())
    expect(md).not.toContain('### Features')
  })

  it('omits error section when no error', () => {
    const md = requestToMarkdown(makeRequest())
    expect(md).not.toContain('### Error')
  })
})

describe('wire data sections', () => {
  it('includes a Network section with wire headers, status, and size', () => {
    const md = requestToMarkdown(
      makeRequest({
        wire: {
          request: {
            method: 'GET',
            url: '/users',
            headers: { 'X-Inertia': 'true', accept: 'text/html' },
            startedAt: 10,
          },
          response: {
            status: 200,
            headers: { 'x-inertia': 'true' },
            bodySize: 2048,
            finishedAt: 55,
          },
        },
      }),
    )

    expect(md).toContain('### Network')
    expect(md).toContain('**Status:** 200')
    expect(md).toContain('**Response size:** 2048 bytes')
    expect(md).toContain('X-Inertia: true')
    expect(md).toContain('x-inertia: true')
  })

  it('omits the Network section without wire data', () => {
    expect(requestToMarkdown(makeRequest())).not.toContain('### Network')
  })

  it('includes Server-Timing metrics in the Network section', () => {
    const md = requestToMarkdown(
      makeRequest({
        wire: {
          request: { method: 'GET', url: '/users', headers: { 'X-Inertia': 'true' }, startedAt: 10 },
          response: { status: 200, headers: {}, finishedAt: 55 },
        },
        network: {
          url: '/users',
          duration: 45,
          startedAt: 10,
          finishedAt: 55,
          serverTiming: [
            { name: 'db', duration: 12.34, description: 'SELECT queries' },
            { name: 'app', duration: 20, description: '' },
          ],
        },
      }),
    )

    expect(md).toContain('**Server timing:**')
    expect(md).toContain('db: 12.3ms — SELECT queries')
    expect(md).toContain('app: 20ms')
  })

  it('emits a Network section for Server-Timing metrics without wire data (fallback mode)', () => {
    const md = requestToMarkdown(
      makeRequest({
        network: {
          url: '/users',
          duration: 45,
          startedAt: 10,
          finishedAt: 55,
          serverTiming: [{ name: 'app', duration: 30, description: '' }],
        },
      }),
    )

    expect(md).toContain('### Network')
    expect(md).toContain('app: 30ms')
  })

  it('notes cache-served visits in the header', () => {
    const md = requestToMarkdown(makeRequest({ cached: true }))
    expect(md).toContain('**Served from prefetch cache:** Yes')
  })
})

describe('diffToMarkdown', () => {
  it('includes navigation, component, and url in the header', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ props: { a: 1 } }),
        page: makePage({ props: { a: 2 } }),
      }),
    )
    expect(md).toContain('## Inertia Props Diff')
    expect(md).toContain('**Navigation:** GET /users → 200 (45ms)')
    expect(md).toContain('**Component:** Pages/Users/Index')
    expect(md).toContain('**URL:** /users')
  })

  it('shows component and url transitions when they changed', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ component: 'Pages/A', url: '/a', props: {} }),
        page: makePage({ component: 'Pages/B', url: '/b', props: {} }),
      }),
    )
    expect(md).toContain('**Component:** Pages/A → Pages/B')
    expect(md).toContain('**URL:** /a → /b')
  })

  it('groups changes into Added/Removed/Changed with before → after values', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ props: { theme: 'light', legacy: true, user: { name: 'Ann', age: 30 } } }),
        page: makePage({ props: { theme: 'dark', fresh: 1, user: { name: 'Ann', age: 31 } } }),
      }),
    )
    expect(md).toContain('### Added (1)')
    expect(md).toContain('- `fresh`: 1')
    expect(md).toContain('### Removed (1)')
    expect(md).toContain('- `legacy`: true')
    expect(md).toContain('### Changed (2)')
    expect(md).toContain('- `theme`: "light" → "dark"')
    expect(md).toContain('- `user.age`: 30 → 31')
    expect(md).not.toContain('user.name')
  })

  it('uses index paths for array element changes', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ props: { items: ['a', 'b'] } }),
        page: makePage({ props: { items: ['a', 'c', 'd'] } }),
      }),
    )
    expect(md).toContain('- `items[1]`: "b" → "c"')
    expect(md).toContain('- `items[2]`: "d"')
    expect(md).not.toContain('items[0]')
  })

  it('truncates huge values with a note', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ props: {} }),
        page: makePage({ props: { blob: 'x'.repeat(300) } }),
      }),
    )
    expect(md).toContain('… (truncated, 302 chars total)')
    expect(md).not.toContain('x'.repeat(300))
  })

  it('notes when there is no previous page to diff against', () => {
    const md = diffToMarkdown(makeRequest())
    expect(md).toContain('_No previous page captured — nothing to diff against._')
  })

  it('notes when the request has no page object', () => {
    const md = diffToMarkdown(makeRequest({ page: undefined, previousPage: makePage() }))
    expect(md).toContain('_No page object captured for this request._')
  })

  it('notes when nothing changed', () => {
    const md = diffToMarkdown(
      makeRequest({
        previousPage: makePage({ props: { a: 1 } }),
        page: makePage({ props: { a: 1 } }),
      }),
    )
    expect(md).toContain('_No prop changes._')
  })
})

describe('eventsToMarkdown', () => {
  it('lists events with +offsets and includes navigation/outcome', () => {
    const md = eventsToMarkdown(
      makeRequest({
        events: [
          makeEvent(1, 'inertia:before', 100, { visit: { url: '/users' } }),
          makeEvent(2, 'inertia:start', 102),
          makeEvent(3, 'inertia:success', 140),
          makeEvent(4, 'inertia:finish', 145, { visit: { cancelled: false, interrupted: false } }),
        ],
      }),
    )
    expect(md).toContain('## Inertia Events')
    expect(md).toContain('**Navigation:** GET /users → 200 (45ms)')
    expect(md).toContain('**Outcome:** completed')
    expect(md).toContain('- +0ms `inertia:before`')
    expect(md).toContain('- +2ms `inertia:start`')
    expect(md).toContain('- +45ms `inertia:finish`')
    expect(md).not.toContain('cancelled')
  })

  it('highlights error keys', () => {
    const md = eventsToMarkdown(
      makeRequest({
        events: [
          makeEvent(1, 'inertia:before', 0),
          makeEvent(2, 'inertia:error', 40, { errors: { name: 'Required', email: 'Invalid' } }),
        ],
      }),
    )
    expect(md).toContain('- +40ms `inertia:error` — errors: name, email')
  })

  it('highlights cancelled visits in event lines and outcome', () => {
    const md = eventsToMarkdown(
      makeRequest({
        cancelled: true,
        completed: false,
        events: [makeEvent(1, 'inertia:before', 0), makeEvent(2, 'inertia:finish', 5, { visit: { cancelled: true } })],
      }),
    )
    expect(md).toContain('**Outcome:** cancelled')
    expect(md).toContain('- +5ms `inertia:finish` — cancelled')
  })

  it('reports an HTTP error as failed, not completed', () => {
    // `failed && completed` is the NORMAL state of every 4xx/5xx: Inertia's
    // finish() runs in a .finally() and sets completed regardless. Testing
    // completed first made every server error export as "Outcome: completed" —
    // the one line a reader skims to see whether the request worked.
    const md = eventsToMarkdown(makeRequest({ failed: true, completed: true, status: 500 }))
    expect(md).toContain('**Outcome:** failed (HTTP 500)')
    expect(md).not.toContain('**Outcome:** completed')
  })

  it('still reports a plain success as completed', () => {
    expect(eventsToMarkdown(makeRequest({ completed: true, status: 200 }))).toContain('**Outcome:** completed')
  })

  it('prefers an explicit cancel over the failed flag', () => {
    // A cancelled request is also marked failed by some paths; "cancelled" is
    // the more specific and more useful answer.
    const md = eventsToMarkdown(makeRequest({ failed: true, completed: true, cancelled: true }))
    expect(md).toContain('**Outcome:** cancelled')
  })

  it('highlights prevented and cache-served events', () => {
    const md = eventsToMarkdown(
      makeRequest({
        events: [makeEvent(1, 'inertia:before', 0, {}, true), makeEvent(2, 'inertia:navigate', 3, { cached: true })],
      }),
    )
    expect(md).toContain('- +0ms `inertia:before` — prevented')
    expect(md).toContain('- +3ms `inertia:navigate` — served from prefetch cache')
  })

  it('groups consecutive progress events into one line with the last percentage', () => {
    const md = eventsToMarkdown(
      makeRequest({
        events: [
          makeEvent(1, 'inertia:before', 0),
          makeEvent(2, 'inertia:progress', 10, { percentage: 30 }),
          makeEvent(3, 'inertia:progress', 12, { percentage: 60 }),
          makeEvent(4, 'inertia:progress', 14, { percentage: 100 }),
          makeEvent(5, 'inertia:success', 20),
        ],
      }),
    )
    expect(md).toContain('- +10ms `inertia:progress` ×3 (last 100%)')
    expect(md).not.toContain('+12ms')
  })

  it('notes when no events were captured', () => {
    expect(eventsToMarkdown(makeRequest())).toContain('_No events captured._')
  })
})

describe('networkToMarkdown', () => {
  it('includes navigation plus wire status, headers, and server timing', () => {
    const md = networkToMarkdown(
      makeRequest({
        wire: {
          request: { method: 'GET', url: '/users', headers: { 'X-Inertia': 'true' }, startedAt: 10 },
          response: { status: 200, headers: { 'x-inertia': 'true' }, bodySize: 2048, finishedAt: 55 },
        },
        network: {
          url: '/users',
          duration: 45,
          startedAt: 10,
          finishedAt: 55,
          serverTiming: [{ name: 'db', duration: 12.34, description: 'SELECT queries' }],
        },
      }),
    )
    expect(md).toContain('## Inertia Network')
    expect(md).toContain('**Navigation:** GET /users → 200 (45ms)')
    expect(md).toContain('**Status:** 200')
    expect(md).toContain('**Response size:** 2048 bytes')
    expect(md).toContain('X-Inertia: true')
    expect(md).toContain('db: 12.3ms — SELECT queries')
  })

  it('falls back to a notice when no wire data exists', () => {
    const md = networkToMarkdown(makeRequest())
    expect(md).toContain('## Inertia Network')
    expect(md).toContain('_No wire data captured')
  })
})

describe('requestToJSON', () => {
  it('produces parseable JSON with the page object included', () => {
    const parsed = JSON.parse(requestToJSON(makeRequest())) as Record<string, unknown>
    expect(parsed.method).toBe('GET')
    expect(parsed.url).toBe('/users')
    expect((parsed.page as InertiaPage).component).toBe('Pages/Users/Index')
    expect((parsed.page as InertiaPage).props).toEqual({ users: [1, 2], flash: {} })
  })

  it('drops devtools-internal correlation ids', () => {
    const parsed = JSON.parse(
      requestToJSON(makeRequest({ events: [makeEvent(7, 'inertia:before', 0, { visit: { url: '/users' } })] })),
    ) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('visitId')
    expect(parsed).not.toHaveProperty('inertiaVisitId')
    expect(parsed).not.toHaveProperty('parentVisitId')
    const events = parsed.events as Record<string, unknown>[]
    expect(events[0]).not.toHaveProperty('id')
    expect(events[0].name).toBe('inertia:before')
    expect((events[0].detail as Record<string, unknown>).visit).toEqual({ url: '/users' })
  })

  it('stringifies errors and omits absent optional fields', () => {
    const parsed = JSON.parse(requestToJSON(makeRequest({ error: new Error('boom') }))) as Record<string, unknown>
    expect(parsed.error).toBe('Error: boom')
  })

  it('keeps validation errors structured instead of exporting [object Object]', () => {
    const errors = { name: 'The name field is required.' }
    const parsed = JSON.parse(requestToJSON(makeRequest({ error: errors }))) as Record<string, unknown>
    expect(parsed.error).toEqual(errors)
    expect(parsed).not.toHaveProperty('wire')
    expect(parsed).not.toHaveProperty('redirectUrl')
  })

  it('survives circular references in event details', () => {
    const detail: Record<string, unknown> = {}
    detail.self = detail
    const json = requestToJSON(makeRequest({ events: [makeEvent(1, 'inertia:before', 0, detail)] }))
    expect(json).toContain('[Circular]')
  })
})

/** A credential past `redactDeep`'s depth cap — the capture-time walk gives up here. */
function deeplyBuriedBody() {
  let node: Record<string, unknown> = { password: 'DEEP-BODY-ggg' }
  for (let i = 0; i < 12; i++) node = { nest: node }
  return node
}

describe('requestToJSON page de-duplication', () => {
  const page = makePage({ props: { rows: [{ id: 1, blurb: 'x'.repeat(200) }] } })

  it('elides an event page identical to the top-level page', () => {
    // Three events per visit carry a structuredClone of the page, so a 187 KB
    // page produced a 1.19 MB export — past a GitHub comment limit and most
    // context windows, at exactly the size where the feature is most needed.
    const json = requestToJSON(
      makeRequest({
        page,
        events: [makeEvent(1, 'inertia:success', 10, { page }), makeEvent(2, 'inertia:navigate', 11, { page })],
      }),
    )
    expect(json).toContain('identical to page')
    // The full props survive exactly once, at the top level.
    expect(json.match(/x{200}/g)).toHaveLength(1)
  })

  it('elides against previousPage too', () => {
    const json = requestToJSON(
      makeRequest({
        page: makePage({ props: { other: 1 } }),
        previousPage: page,
        events: [makeEvent(1, 'inertia:beforeUpdate', 10, { page })],
      }),
    )
    expect(json).toContain('identical to previousPage')
  })

  it('keeps an event page that differs from both — it is telling us something', () => {
    const odd = makePage({ props: { unique: 'KEEP-ME' } })
    const json = requestToJSON(
      makeRequest({
        page,
        previousPage: makePage({ props: { p: 1 } }),
        events: [makeEvent(1, 'inertia:success', 10, { page: odd })],
      }),
    )
    expect(json).toContain('KEEP-ME')
    expect(json).not.toContain('identical to')
  })

  it('leaves details with no page alone', () => {
    const json = requestToJSON(
      makeRequest({ page, events: [makeEvent(1, 'inertia:progress', 10, { percentage: 50 })] }),
    )
    expect(json).toContain('"percentage": 50')
  })
})

describe('export redaction (page props reach the clipboard)', () => {
  // Rails and Laravel adapters share a live csrf_token in props on EVERY page.
  // "Copy for AI" exists to be pasted into issues and chats, so every exporter
  // has to mask them — enumerated here rather than spot-checked, because the
  // last redaction pass shipped with a third leak path nobody had listed.
  const SECRETS = {
    csrf_token: 'CSRF-LIVE-aaa',
    api_token: 'API-LIVE-bbb',
    stripe_secret: 'SK-LIVE-ccc',
    _token: 'UNDERSCORE-LIVE-ddd',
    session_id: 'SESSION-LIVE-eee',
  }

  // Distinct values per page so the DIFF exporter must emit them as changed —
  // identical values would be reported as unchanged and silently pass.
  function pageWithSecrets(component: string, tag = ''): InertiaPage {
    const tagged = Object.fromEntries(Object.entries(SECRETS).map(([k, v]) => [k, v + tag]))
    return {
      component,
      props: { users: [{ name: 'Ada' }], ...tagged, nested: { deep: { api_key: 'NESTED-LIVE-fff' + tag } } },
      url: '/users',
      version: 'a3f2c1d',
      clearHistory: false,
      encryptHistory: false,
      flash: {},
    }
  }

  const leaky = () =>
    makeRequest({
      // Query-string credentials: password-reset links, magic-link callbacks,
      // signed S3 URLs. Emitted by every exporter that prints a URL.
      url: '/users?reset_token=URL-LIVE-hhh&page=2',
      redirectUrl: '/callback?access_key=REDIRECT-LIVE-iii',
      page: pageWithSecrets('Pages/Users/Index'),
      previousPage: pageWithSecrets('Pages/Users/Edit', '-PREV'),
      // A live reference into the raw page — exported masked as `page.flash`
      // and plain as `features[].details` in the same JSON blob.
      features: [{ type: 'flash', label: 'FLASH', details: { flash: { reset_token: 'FLASH-LIVE-jjj' } } }],
      // The request BODY. Only ever saw the depth-capped, fail-open redactDeep.
      visitOptions: { data: deeplyBuriedBody(), headers: { Authorization: 'Bearer OPTS-LIVE-kkk' } },
      events: [
        {
          id: 1,
          name: 'inertia:success',
          timestamp: 10,
          // safeSerializeDetail structuredClones `page` verbatim, so raw event
          // details carry a second full copy of the props.
          detail: { page: pageWithSecrets('Pages/Users/Index') },
        } as CapturedEvent,
      ],
    } as Partial<RequestRecord>)

  const ALL_SECRETS = [
    ...Object.values(SECRETS),
    'NESTED-LIVE-fff',
    'DEEP-BODY-ggg',
    'URL-LIVE-hhh',
    'REDIRECT-LIVE-iii',
    'FLASH-LIVE-jjj',
    'OPTS-LIVE-kkk',
  ]

  const exporters: Array<[string, (r: RequestRecord) => string]> = [
    ['requestToMarkdown', requestToMarkdown],
    ['diffToMarkdown', diffToMarkdown],
    ['eventsToMarkdown', eventsToMarkdown],
    ['networkToMarkdown', networkToMarkdown],
    ['requestToJSON', requestToJSON],
  ]

  for (const [name, exporter] of exporters) {
    it(`${name} leaks no credential from props, previousPage, or event details`, () => {
      const output = exporter(leaky())
      for (const secret of ALL_SECRETS) {
        expect(output, `${name} leaked ${secret}`).not.toContain(secret)
      }
    })
  }

  it('still exports the non-sensitive props that make the export useful', () => {
    const output = requestToJSON(leaky())
    expect(output).toContain('Ada')
    expect(output).toContain('Pages/Users/Index')
  })

  it('marks masked values rather than dropping the keys', () => {
    const output = requestToJSON(leaky())
    expect(output).toContain('csrf_token')
    expect(output).toContain('[REDACTED]')
  })
})
