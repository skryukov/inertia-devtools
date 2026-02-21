import { describe, it, expect } from 'vitest'
import { requestToMarkdown } from './markdown'
import type { RequestRecord } from './types'

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

describe('requestToMarkdown', () => {
  it('includes header with navigation info', () => {
    const md = requestToMarkdown(makeRequest())
    expect(md).toContain('## Inertia Request')
    expect(md).toContain('**Navigation:** GET /users → 200 (45ms)')
    expect(md).toContain('**Component:** Pages/Users/Index')
    expect(md).toContain('**Type:** full')
  })

  it('shows "initial page load" for synthetic initial record', () => {
    const md = requestToMarkdown(makeRequest({ duration: 0 }))
    expect(md).toContain('(initial page load)')
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

  it('shows cancelled/interrupted flags', () => {
    const md = requestToMarkdown(makeRequest({ cancelled: true }))
    expect(md).toContain('**Cancelled:** Yes')

    const md2 = requestToMarkdown(makeRequest({ interrupted: true }))
    expect(md2).toContain('**Interrupted:** Yes')
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
