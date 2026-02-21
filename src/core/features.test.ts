import { describe, it, expect } from 'vitest'
import { extractFeatures } from './features'
import type { InertiaPage } from './protocol'
import type { RequestRecord } from './types'

function makePage(overrides: Partial<InertiaPage> = {}): InertiaPage {
  return {
    component: 'Test',
    props: {},
    url: '/test',
    version: '1',
    clearHistory: false,
    encryptHistory: false,
    flash: {},
    ...overrides,
  }
}

function makeRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    visitId: 1,
    type: 'full',
    method: 'GET',
    url: '/test',
    startedAt: 100,
    events: [{ id: 1, name: 'inertia:start', timestamp: 100, detail: {} }],
    features: [],
    diagnostics: [],
    cancelled: false,
    interrupted: false,
    completed: true,
    ...overrides,
  }
}

describe('extractFeatures', () => {
  it('returns empty array for a plain full page visit', () => {
    const features = extractFeatures(makeRecord(), makePage())
    expect(features).toEqual([])
  })

  it('detects partial reload', () => {
    const features = extractFeatures(makeRecord({ type: 'partial' }), makePage())
    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({ type: 'partial', label: 'PARTIAL' })
  })

  it('detects deferred props via deferredProps', () => {
    const page = makePage({ deferredProps: { default: ['users'] } })
    const features = extractFeatures(makeRecord(), page)
    const deferred = features.find((f) => f.type === 'deferred')
    expect(deferred).toBeDefined()
    expect(deferred!.details!.groups).toEqual({ default: ['users'] })
  })

  it('falls back to initialDeferredProps when deferredProps is empty', () => {
    const page = makePage({
      deferredProps: {},
      initialDeferredProps: { default: ['posts'] },
    })
    const features = extractFeatures(makeRecord(), page)
    const deferred = features.find((f) => f.type === 'deferred')
    expect(deferred).toBeDefined()
    expect(deferred!.details!.groups).toEqual({ default: ['posts'] })
  })

  it('does not detect deferred when both are empty', () => {
    const page = makePage({ deferredProps: {}, initialDeferredProps: {} })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'deferred')).toBeUndefined()
  })

  it('detects merge strategies', () => {
    const page = makePage({
      mergeProps: ['items'],
      prependProps: ['notifications'],
      deepMergeProps: ['settings'],
    })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'merge')).toMatchObject({ details: { props: ['items'] } })
    expect(features.find((f) => f.type === 'prepend')).toMatchObject({ details: { props: ['notifications'] } })
    expect(features.find((f) => f.type === 'deep-merge')).toMatchObject({ details: { props: ['settings'] } })
  })

  it('skips merge strategies when arrays are empty', () => {
    const page = makePage({ mergeProps: [], prependProps: [], deepMergeProps: [] })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'merge')).toBeUndefined()
    expect(features.find((f) => f.type === 'prepend')).toBeUndefined()
    expect(features.find((f) => f.type === 'deep-merge')).toBeUndefined()
  })

  it('detects scroll props', () => {
    const page = makePage({ scrollProps: { cursor: 'abc' } })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'scroll')).toMatchObject({
      details: { props: { cursor: 'abc' } },
    })
  })

  it('detects once props', () => {
    const page = makePage({ onceProps: { token: { prop: 'token' } } })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'once')).toBeDefined()
  })

  it('detects encrypted history', () => {
    const page = makePage({ encryptHistory: true })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'encrypted')).toMatchObject({ label: 'ENCRYPTED' })
  })

  it('does not detect encrypted history when false', () => {
    const page = makePage({ encryptHistory: false })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'encrypted')).toBeUndefined()
  })

  it('detects clear history', () => {
    const page = makePage({ clearHistory: true })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'clear-history')).toBeDefined()
  })

  it('detects prefetch', () => {
    const features = extractFeatures(makeRecord({ type: 'prefetch' }), makePage())
    expect(features.find((f) => f.type === 'prefetch')).toMatchObject({ label: 'PREFETCH' })
  })

  it('detects flash data', () => {
    const page = makePage({ flash: { success: 'Saved!' } })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'flash')).toMatchObject({
      details: { flash: { success: 'Saved!' } },
    })
  })

  it('skips flash when empty', () => {
    const page = makePage({ flash: {} })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'flash')).toBeUndefined()
  })

  it('detects cached prefetch (no inertia:start event)', () => {
    const record = makeRecord({
      type: 'full',
      startedAt: 100,
      events: [{ id: 1, name: 'inertia:finish', timestamp: 200, detail: {} }],
    })
    const features = extractFeatures(record, makePage())
    expect(features.find((f) => f.type === 'cached')).toMatchObject({ label: 'CACHED' })
  })

  it('does not detect cached when inertia:start is present', () => {
    const record = makeRecord({
      type: 'full',
      startedAt: 100,
      events: [{ id: 1, name: 'inertia:start', timestamp: 100, detail: {} }],
    })
    const features = extractFeatures(record, makePage())
    expect(features.find((f) => f.type === 'cached')).toBeUndefined()
  })

  it('does not detect cached for client visits', () => {
    const record = makeRecord({
      type: 'client',
      startedAt: 100,
      events: [],
    })
    const features = extractFeatures(record, makePage())
    expect(features.find((f) => f.type === 'cached')).toBeUndefined()
  })

  it('detects remembered state', () => {
    const page = makePage({ rememberedState: { form: { name: 'Alice' } } })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'remember')).toMatchObject({
      details: { keys: ['form'] },
    })
  })

  it('skips remembered state when empty', () => {
    const page = makePage({ rememberedState: {} })
    const features = extractFeatures(makeRecord(), page)
    expect(features.find((f) => f.type === 'remember')).toBeUndefined()
  })

  it('detects multiple features simultaneously', () => {
    const record = makeRecord({ type: 'partial' })
    const page = makePage({
      mergeProps: ['items'],
      flash: { info: 'Hello' },
      encryptHistory: true,
    })
    const features = extractFeatures(record, page)
    const types = features.map((f) => f.type)
    expect(types).toContain('partial')
    expect(types).toContain('merge')
    expect(types).toContain('flash')
    expect(types).toContain('encrypted')
  })
})
