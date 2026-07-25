import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startCapture } from './capture'
import { INERTIA_DOM_EVENTS } from './protocol'
import type { DevToolsStore } from './store'

function makeStoreMock(): DevToolsStore {
  return {
    captureEvent: vi.fn(),
    getState: vi.fn(),
    subscribe: vi.fn(),
    clear: vi.fn(),
    setPanelOpen: vi.fn(),
  } as unknown as DevToolsStore
}

/** Dispatch is deferred by one microtask — wait for the flush. */
const flushCapture = () => Promise.resolve()

describe('startCapture', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener')
    removeSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('attaches listeners for all Inertia events', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    expect(addSpy).toHaveBeenCalledTimes(INERTIA_DOM_EVENTS.length)
    for (const name of INERTIA_DOM_EVENTS) {
      expect(addSpy).toHaveBeenCalledWith(name, expect.any(Function))
    }

    stop()
  })

  it('forwards events to store.captureEvent with a capture-time timestamp', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    const detail = { visit: { url: '/test', method: 'get' } }
    document.dispatchEvent(new CustomEvent('inertia:before', { detail }))

    // Dispatch is deferred until the microtask flush
    expect(store.captureEvent).not.toHaveBeenCalled()
    await flushCapture()

    expect(store.captureEvent).toHaveBeenCalledTimes(1)
    expect(store.captureEvent).toHaveBeenCalledWith('inertia:before', expect.any(Event), expect.any(Number))

    stop()
  })

  it('preserves relative order for events fired in the same task (before → start)', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    document.dispatchEvent(new CustomEvent('inertia:start', { detail: {} }))
    await flushCapture()

    const calls = (store.captureEvent as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.map((c) => c[0])).toEqual(['inertia:before', 'inertia:start'])

    stop()
  })

  it('sees defaultPrevented from listeners registered after the devtools', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    // App listener registered AFTER devtools — runs later in the same dispatch,
    // so only the deferred flush can observe its preventDefault().
    document.addEventListener('inertia:before', (e) => e.preventDefault(), { once: true })

    document.dispatchEvent(new CustomEvent('inertia:before', { cancelable: true, detail: {} }))
    await flushCapture()

    const [, event] = (store.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((event as Event).defaultPrevented).toBe(true)

    stop()
  })

  it('isolates errors — does not throw when store.captureEvent throws', async () => {
    const store = makeStoreMock()
    ;(store.captureEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom')
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const stop = startCapture(store)

    expect(() => {
      document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    }).not.toThrow()
    await flushCapture()

    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
    groupSpy.mockRestore()
    groupEndSpy.mockRestore()
    stop()
  })

  it('cleanup removes all listeners', () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    stop()

    expect(removeSpy).toHaveBeenCalledTimes(INERTIA_DOM_EVENTS.length)
    for (const name of INERTIA_DOM_EVENTS) {
      expect(removeSpy).toHaveBeenCalledWith(name, expect.any(Function))
    }
  })

  it('multiple events forwarded independently', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: { a: 1 } }))
    document.dispatchEvent(new CustomEvent('inertia:navigate', { detail: { b: 2 } }))
    await flushCapture()

    expect(store.captureEvent).toHaveBeenCalledTimes(2)
    expect((store.captureEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('inertia:before')
    expect((store.captureEvent as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('inertia:navigate')

    stop()
  })

  it('does not forward events after cleanup', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    stop()

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    await flushCapture()
    expect(store.captureEvent).not.toHaveBeenCalled()
  })

  it('drops events still buffered when cleanup runs before the flush', async () => {
    const store = makeStoreMock()
    const stop = startCapture(store)

    document.dispatchEvent(new CustomEvent('inertia:before', { detail: {} }))
    stop()
    await flushCapture()

    expect(store.captureEvent).not.toHaveBeenCalled()
  })
})
