import { describe, it, expect } from 'vitest'
import { computeDiagnostics } from './diagnostics'
import type { RequestRecord } from './types'

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
    it('detects 409 redirect as version mismatch', () => {
      const req = makeRequest({ type: 'redirect', status: 409 })
      const diags = computeDiagnostics(req)
      expect(diags).toHaveLength(1)
      expect(diags[0].id).toBe('version-mismatch')
      expect(diags[0].severity).toBe('warning')
    })

    it('does not trigger for non-409 redirect', () => {
      const req = makeRequest({ type: 'redirect', status: 302 })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'version-mismatch')).toBeUndefined()
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
        page: {
          component: 'Users/Index',
          props: { users: [], roles: [] },
          url: '/users',
          version: '1',
          encryptHistory: false,
          clearHistory: false,
          flash: {},
        },
      })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'partial-prop-missing')).toBeUndefined()
    })
  })

  describe('detectErrorsFiltered', () => {
    it('detects errors filtered out with 422 status', () => {
      const req = makeRequest({ only: ['name'], status: 422 })
      const diags = computeDiagnostics(req)
      const diag = diags.find((d) => d.id === 'errors-filtered')
      expect(diag).toBeDefined()
      expect(diag!.severity).toBe('warning')
    })

    it('does not trigger when only includes errors', () => {
      const req = makeRequest({ only: ['name', 'errors'], status: 422 })
      const diags = computeDiagnostics(req)
      expect(diags.find((d) => d.id === 'errors-filtered')).toBeUndefined()
    })
  })

  describe('detectDeferredFailed', () => {
    it('detects failed deferred request', () => {
      const req = makeRequest({ type: 'deferred', error: new Error('timeout') })
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
