import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startInterceptorCapture, wireBodySize } from './interceptors'
import { DevToolsStore } from './store'

type RequestHandler = (visit: unknown, config: unknown) => unknown
type ResponseHandler = (visit: unknown, response: unknown) => unknown

/** Minimal stand-in for Inertia's window.__inertia_interceptors__. */
function makeFakeInterceptors() {
  const requestHandlers: RequestHandler[] = []
  const responseHandlers: ResponseHandler[] = []
  return {
    requestHandlers,
    responseHandlers,
    onVisitRequest(handler: RequestHandler) {
      requestHandlers.push(handler)
      return () => {
        const i = requestHandlers.indexOf(handler)
        if (i !== -1) requestHandlers.splice(i, 1)
      }
    },
    onVisitResponse(handler: ResponseHandler) {
      responseHandlers.push(handler)
      return () => {
        const i = responseHandlers.indexOf(handler)
        if (i !== -1) responseHandlers.splice(i, 1)
      }
    },
  }
}

function makeCustomEvent(name: string, detail: unknown): CustomEvent {
  return new CustomEvent(name, { detail })
}

function makeVisit(id: string, url = 'http://localhost/users'): Record<string, unknown> {
  return {
    id,
    method: 'get',
    url: new URL(url),
    completed: false,
    cancelled: false,
    interrupted: false,
    only: [],
    except: [],
    prefetch: false,
  }
}

declare global {
  interface Window {
    __inertia_interceptors__?: unknown
  }
}

describe('startInterceptorCapture', () => {
  let store: DevToolsStore

  beforeEach(() => {
    sessionStorage.clear()
    store = new DevToolsStore()
    delete window.__inertia_interceptors__
  })

  afterEach(() => {
    delete window.__inertia_interceptors__
  })

  it('subscribes immediately when the global is already exposed', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake

    startInterceptorCapture(store)

    expect(fake.requestHandlers).toHaveLength(1)
    expect(fake.responseHandlers).toHaveLength(1)
    expect(store.getState().networkCaptureMode).toBe('interceptors')
  })

  it('subscribes lazily when the global appears only after init', () => {
    startInterceptorCapture(store)
    expect(store.getState().networkCaptureMode).toBe('pending')

    // createInertiaApp() runs after devtools init and exposes the global
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake

    // First Inertia event triggers the retry
    store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-1') }))

    expect(fake.requestHandlers).toHaveLength(1)
    expect(fake.responseHandlers).toHaveLength(1)
    expect(store.getState().networkCaptureMode).toBe('interceptors')
  })

  it('settles into fallback mode when the global never appears', () => {
    startInterceptorCapture(store)

    store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-1') }))

    expect(store.getState().networkCaptureMode).toBe('fallback')
  })

  it('attaches request and response wire data to the right record among concurrent visits', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake
    startInterceptorCapture(store)

    const visitA = makeVisit('v-a', 'http://localhost/users')
    const visitB = makeVisit('v-b', 'http://localhost/users')
    store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: visitA }))
    store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: visitB }))

    fake.requestHandlers[0](visitA, {
      method: 'get',
      url: 'http://localhost/users',
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': 'abc' },
    })
    fake.responseHandlers[0](visitB, {
      status: 200,
      data: '{"component":"Users"}',
      headers: { 'x-inertia': 'true' },
    })

    const requests = store.getState().requests
    const recordA = requests.find((r) => r.inertiaVisitId === 'v-a')!
    const recordB = requests.find((r) => r.inertiaVisitId === 'v-b')!

    expect(recordA.wire?.request).toMatchObject({
      method: 'GET',
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': 'abc' },
    })
    expect(recordA.wire?.response).toBeUndefined()
    expect(recordB.wire?.response).toMatchObject({ status: 200, headers: { 'x-inertia': 'true' } })
    expect(recordB.wire?.response?.bodySize).toBe('{"component":"Users"}'.length)
    expect(recordB.status).toBe(200)
  })

  it('returns config and response unchanged (pure observation)', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake
    startInterceptorCapture(store)

    const config = { method: 'post', url: 'http://localhost/posts', headers: {} }
    const response = { status: 200, data: '{}', headers: {} }

    expect(fake.requestHandlers[0](makeVisit('v-1'), config)).toBe(config)
    expect(fake.responseHandlers[0](makeVisit('v-1'), response)).toBe(response)
  })

  it('does not propagate devtools errors into the request flow', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake
    startInterceptorCapture(store)

    vi.spyOn(store, 'attachWireRequest').mockImplementation(() => {
      throw new Error('devtools bug')
    })
    vi.spyOn(store, 'attachWireResponse').mockImplementation(() => {
      throw new Error('devtools bug')
    })

    const config = { method: 'get', url: 'http://localhost/users', headers: {} }
    const response = { status: 200, data: '{}', headers: {} }

    expect(() => fake.requestHandlers[0](makeVisit('v-1'), config)).not.toThrow()
    expect(fake.requestHandlers[0](makeVisit('v-1'), config)).toBe(config)
    expect(() => fake.responseHandlers[0](makeVisit('v-1'), response)).not.toThrow()
  })

  it('ignores wire data for unknown visit ids without crashing', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake
    startInterceptorCapture(store)

    expect(() =>
      fake.requestHandlers[0](makeVisit('v-unknown'), { method: 'get', url: '', headers: {} }),
    ).not.toThrow()
    expect(store.getState().requests).toHaveLength(0)
  })

  it('teardown unsubscribes both interceptors', () => {
    const fake = makeFakeInterceptors()
    window.__inertia_interceptors__ = fake

    const stop = startInterceptorCapture(store)
    expect(fake.requestHandlers).toHaveLength(1)

    stop()
    expect(fake.requestHandlers).toHaveLength(0)
    expect(fake.responseHandlers).toHaveLength(0)
  })

  it('ignores malformed globals', () => {
    window.__inertia_interceptors__ = { not: 'interceptors' }
    startInterceptorCapture(store)

    store.captureEvent('inertia:before', makeCustomEvent('inertia:before', { visit: makeVisit('v-1') }))
    expect(store.getState().networkCaptureMode).toBe('fallback')
  })
})

describe('wireBodySize', () => {
  it('returns UTF-8 byte length for strings', () => {
    expect(wireBodySize('abc')).toBe(3)
    expect(wireBodySize('héllo')).toBe(6)
  })

  it('returns undefined for non-strings', () => {
    expect(wireBodySize(undefined)).toBeUndefined()
    expect(wireBodySize({ a: 1 })).toBeUndefined()
  })
})
